param(
  [Parameter(Mandatory)][ValidateSet('web','plain')][string]$Profile,
  [int]$Port = 3080,        # porta do `dsh web`; so e repassada ao servidor se diferente de 3080
  [switch]$NoOpen,          # nao abre o navegador (testes)
  [switch]$Atualizar,       # reconstroi agora (janela visivel) mesmo que o build pareca em dia
  [switch]$Safe,            # modo seguro: so plugins do FORGE, sem terceiros/MCP; nenhum arquivo do profile e alterado
  [switch]$SimularFalha     # teste do fallback: o boot normal recebe um plugin que nao existe (so nesta subida; nada e gravado no profile)
)
# Abre o FORGE rapido e sem janela: usa o build compilado (apps\cli\lib\bin.js), sobe o servidor escondido
# e deixa o proprio `dsh web` abrir o navegador (ele imprime/abre a URL com o token).
#  - ja existe instancia na porta: so abre o navegador nela (nada de matar, nada de EADDRINUSE);
#  - build defasado (master mudou): abre mesmo assim e avisa com um balao; `-Atualizar` reconstroi;
#  - `-Safe` sobe com `--safe` (pill "Safe mode" na UI); se ja ha instancia no outro modo, ela e reiniciada no modo pedido;
#  - fallback automatico (web, modo normal): se o boot normal falha (processo morreu, porta nao abriu em 45 s, nao terminou em
#    90 s, ou o stderr traz `dsh: warning: N entry did not activate` / `dsh: startup failed:`), mata a instancia, sobe de novo com
#    `--safe` (FORGE_SAFE_REASON = motivo, mostrado na UI) e avisa com balao. Motivo + trechos do log: forge-safe-fallback.log
#    ao lado do cwd do servidor. Se o modo seguro tambem falhar: balao de erro final, sem loop. Boot normal bom: nada muda.
#    Para ver o fallback sem quebrar nada: `launch-forge.ps1 web -SimularFalha`.
#  - o servidor roda com cwd num diretorio neutro, NUNCA na raiz do repo (o sandbox do Forge marca o cwd
#    com integridade Low e isso quebrou os hooks do git; ver Vault-IA/geral/Forge - sandbox Windows ...).
$ErrorActionPreference = 'Stop'
$r = if ($env:FORGE_REPO_ROOT) { $env:FORGE_REPO_ROOT } else { $PSScriptRoot }   # a pasta deste script (instalacao portatil); FORGE_REPO_ROOT: so para testar outra worktree
$state = Join-Path $env:LOCALAPPDATA 'forge-launch'
$serverCwd = if ($env:FORGE_SERVER_CWD) { $env:FORGE_SERVER_CWD } else { Join-Path $state 'server-cwd' }   # fora do repo e do OneDrive
# Um log por porta: uma subida de teste/corrida nao pode apagar o log (com o token) da instancia que esta no ar.
$log = Join-Path $env:LOCALAPPDATA $(if ($Port -eq 3080) { "forge-launch-$Profile.log" } else { "forge-launch-$Profile-$Port.log" })
$bin = Join-Path $r 'apps\cli\lib\bin.js'
$stampFile = Join-Path $state 'build-stamp'
$fallbackLog = Join-Path $serverCwd 'forge-safe-fallback.log'
$oldStamp = Join-Path $r '.launch-build-stamp'
# Tailscale e opcional: so liga o acesso pelo celular. Sem ele (nao instalado/parado/sem login) o resto segue normal.
$tailscale = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
if (-not $tailscale -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) { $tailscale = 'C:\Program Files\Tailscale\tailscale.exe' }
$urlFile = Join-Path $state 'forge-remoto-url.txt'
New-Item -ItemType Directory -Force $state, $serverCwd | Out-Null

function Show-Toast([string]$title, [string]$text) {
  # Balao da bandeja, de um PowerShell escondido que vive ~12s (o launcher principal ja terminou).
  $ico = Join-Path $r 'apps\desktop\resources\forge-logo.ico'
  $code = @"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
`$n = New-Object System.Windows.Forms.NotifyIcon
`$n.Icon = if (Test-Path '$ico') { New-Object System.Drawing.Icon('$ico') } else { [System.Drawing.SystemIcons]::Information }
`$n.Visible = `$true
`$n.ShowBalloonTip(10000, '$($title -replace "'","''")', '$($text -replace "'","''")', 'Info')
Start-Sleep 12
`$n.Dispose()
"@
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-EncodedCommand', $enc | Out-Null
}

function Test-PortOpen([int]$p) {
  $c = New-Object Net.Sockets.TcpClient
  try { $a = $c.BeginConnect('127.0.0.1', $p, $null, $null); return ($a.AsyncWaitHandle.WaitOne(300) -and $c.Connected) }
  catch { return $false } finally { $c.Close() }
}

# --- Tailscale (acceso do celular): helpers ----------------------------------------------------------------------

function Invoke-Ts {
  # Tailscale parado/sem login escreve no stderr; com $ErrorActionPreference='Stop' o `2>&1` virava excecao e derrubava o launcher
  # antes de subir o servidor. Aqui qualquer falha vira saida vazia (= "sem Tailscale", segue so local).
  if (-not $tailscale) { return '' }
  $ErrorActionPreference = 'Continue'
  try { (& $tailscale @args 2>&1 | Out-String) } catch { '' }
}

function Get-TailscaleHost {
  # Hostname MagicDNS do dispositivo (ex.: desktop-trkmgsj.tail496ab6.ts.net); $null se Tailscale
  # nao esta logado/conectado. Serve publica a base dele.
  $st = (Invoke-Ts status --json).Trim()
  if (-not $st) { return $null }
  $j = try { $st | ConvertFrom-Json } catch { return $null }
  if (-not $j -or $j.BackendState -ne 'Running' -or -not $j.Self.DNSName) { return $null }
  $j.Self.DNSName.TrimEnd('.')
}

function Get-ServeHost {
  # Hostname publico que Serve publica: le a autoridade da config Web do `serve status --json`
  # (ex.: "desktop-trkmgsj.tail496ab6.ts.net:443") e quita o puerto. Fallback: MagicDNS do device.
  $st = (Invoke-Ts serve status --json).Trim()
  $j = try { if ($st) { $st | ConvertFrom-Json } } catch { $null }
  if ($j -and $j.Web) {
    $k = ($j.Web.PSObject.Properties | Select-Object -First 1 -ExpandProperty Name)
    if ($k) { return $k.Replace(':' + (($k -split ':')[-1]), '') }
  }
  Get-TailscaleHost
}

function Ensure-Serve([int]$port) {
  # Idempotente: se Serve ja proxya "/" a este loopback, nao toca nada; senao reseta e
  # configura `serve --bg <port>`. Devolve $null (ok) ou un motivo de falha.
  $st = (Invoke-Ts serve status --json).Trim()
  $probe = '"Proxy":\s*"http://127\.0\.0\.1:' + $port + '"'
  if ($st -and $st -match $probe) { return $null }
  Invoke-Ts serve reset | Out-Null
  $out = (Invoke-Ts serve --bg $port)
  if ($out -match 'not enabled') { return "Serve no esta habilitado na tailnet. Ativa em: https://login.tailscale.com/f/serve" }
  if ($out -match 'invalid argument') { return "Erro de sintaxis de tailscale serve: $($out.Trim())" }
  $st2 = (Invoke-Ts serve status --json).Trim()
  if (-not ($st2 -match $probe)) { return 'Serve nao confirmou o proxy ao loopback' }
  $null
}

function Get-CodeStamp {
  # Identifica a versao do codigo: HEAD do git (checkout) ou o hash do pnpm-lock.yaml (instalacao por zip, sem .git).
  if (Test-Path (Join-Path $r '.git')) { try { return (git -C $r rev-parse HEAD).Trim() } catch { } }
  $lock = Join-Path $r 'pnpm-lock.yaml'
  if (Test-Path $lock) { return (Get-FileHash $lock -Algorithm SHA256).Hash }
  ''
}

function Get-ForgeProcs {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'apps\\cli\\lib\\bin\.js' }
}

function Stop-Forge { Get-ForgeProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }

function Open-Existing([int]$p) {
  # Abre o navegador na instancia que ja esta no ar usando a URL com token do log DELA. Sem token conhecido
  # (instancia iniciada por outro caminho, log apagado) o navegador cairia na tela "authentication required",
  # que parece janela vazia: devolve $false e o chamador reinicia o servidor.
  $owner = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $owner -or -not (Test-Path $log)) { return $false }
  $proc = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
  if (-not $proc -or (Get-Item $log).LastWriteTime -lt $proc.StartTime.AddSeconds(-5)) { return $false }
  $m = Select-String -Path $log -Pattern 'http://127\.0\.0\.1:\d+/\?token=\S+' | Select-Object -Last 1
  if (-not $m) { return $false }
  if (-not $NoOpen) { Start-Process $m.Matches[0].Value }
  return $true
}

# Script das fases do build, materializado em %LOCALAPPDATA%\forge-launch (fora do repo) por Build-Forge.
# Literal de proposito: o que esta escrito aqui roda no processo filho sem interpolacao do launcher.
$buildFases = @'
param([Parameter(Mandatory)][string]$Raiz)

# Build do FORGE em fases, com o tempo de cada uma (gerado por launch-forge.ps1 - nao editar aqui:
# a proxima atualizacao sobrescreve este arquivo).
$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'forge-launch'
New-Item -ItemType Directory -Force $state | Out-Null
$tempoLog = Join-Path $state 'build-forge-tempos.log'
$lockHashFile = Join-Path $state 'pnpm-lock.sha256'

$Host.UI.RawUI.WindowTitle = 'Atualizando FORGE - aguarde'
Set-Location $Raiz

$tempos = New-Object System.Collections.Generic.List[object]

function Registrar([string]$fase, [double]$segundos, [bool]$falhou, [string]$nota) {
  $tempos.Add([pscustomobject]@{ Fase = $fase; Segundos = $segundos; Falhou = $falhou; Nota = $nota })
}

function Encerrar([int]$codigo) {
  $total = ($tempos | Measure-Object -Property Segundos -Sum).Sum
  if (-not $total) { $total = 0 }
  Write-Host ''
  if ($codigo -eq 0) { Write-Host ('Build concluido em {0}s' -f [math]::Round($total, 1)) -ForegroundColor Green }
  else { Write-Host ('Build interrompido depois de {0}s' -f [math]::Round($total, 1)) -ForegroundColor Red }
  $head = ''
  try { if (Test-Path (Join-Path $Raiz '.git')) { $head = (git rev-parse --short HEAD).Trim() } } catch { }
  $linhas = $tempos | ForEach-Object {
    $estado = if ($_.Falhou) { '  FALHOU' } else { '' }
    $nota = if ($_.Nota) { '  ' + $_.Nota } else { '' }
    '{0,-12} {1,7}s{2}{3}' -f $_.Fase, $_.Segundos, $estado, $nota
  }
  Add-Content -Path $tempoLog -Encoding UTF8 -Value (@(
    ('=== {0}  (HEAD {1}) ===' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $head)
    $linhas
    ''
  ) -join "`r`n")
  exit $codigo
}

function Passo([string]$nome, [scriptblock]$acao) {
  Write-Host ''
  Write-Host ('== ' + $nome) -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $acao
  $codigo = $LASTEXITCODE
  $sw.Stop()
  $s = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  if ($codigo) { Write-Host ('   FALHOU depois de {0}s' -f $s) -ForegroundColor Red }
  else { Write-Host ('   ok em {0}s' -f $s) -ForegroundColor DarkGray }
  Registrar $nome $s ([bool]$codigo) ''
  if ($codigo) { Encerrar 1 }
}

# install: so quando o lockfile mudou. Sem mudanca o pnpm responde "Already up to date" em ~1s, mas
# pulando a atualizacao nao toca no store nem na rede. Com dependencia nova, roda normal.
$lock = Join-Path $Raiz 'pnpm-lock.yaml'
$hash = (Get-FileHash $lock -Algorithm SHA256).Hash
$anterior = if (Test-Path $lockHashFile) { (Get-Content $lockHashFile -Raw).Trim() } else { '' }
if ((Test-Path (Join-Path $Raiz 'node_modules\.pnpm')) -and $hash -eq $anterior) {
  Write-Host ''
  Write-Host '== install: pulado (lockfile igual ao do ultimo build)' -ForegroundColor DarkGray
  Registrar 'install' 0 $false '(pulado)'
} else {
  Passo 'install' { pnpm install --frozen-lockfile }
  Set-Content -Path $lockHashFile -Value $hash -Encoding UTF8
}

# As tres fases seguem os scripts do repo (sem reimplementar os internos deles aqui).
Passo 'host' { pnpm run build:lib:host }
Passo 'client' { pnpm run build:lib:client }
Passo 'web' { pnpm run build:web }

Encerrar 0
'@

function Build-Forge {
  # Janela visivel de proposito: e o caminho lento (so primeira vez, `-Atualizar` ou lib ausente).
  # O processo filho roda o script das fases acima e grava o tempo de cada uma em
  # build-forge-tempos.log (ao lado de build-stamp), para saber onde a atualizacao pesa.
  Set-Location $r
  $head = Get-CodeStamp
  $fases = Join-Path $state 'build-forge.ps1'
  Set-Content -Path $fases -Encoding UTF8 -Value $buildFases
  $p = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$fases`"", '-Raiz', "`"$r`"" -Wait -PassThru
  if ($p.ExitCode -eq 0) { Set-Content $stampFile $head }
  else { Show-Toast 'FORGE' 'Falha ao reconstruir; abrindo a versao anterior.' }
}

# --- Fallback para o modo seguro: leitura do boot -----------------------------------------------------------------
$ActivationPattern = '^dsh( web)?: (warning: (\d+) entr(?:y|ies) did not activate|startup failed:)'

function Get-ErrLines { if (Test-Path "$log.err") { @(Get-Content "$log.err" -Encoding UTF8 -ErrorAction SilentlyContinue) } else { @() } }

function Get-ServerUrl {
  # A linha `dsh web: <url com token>` so sai depois que a arvore de plugins assentou e foi auditada.
  if (-not (Test-Path $log)) { return $null }
  $m = Select-String -Path $log -Pattern 'http://127\.0\.0\.1:\d+/\?token=\S+' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($m) { $m.Matches[0].Value } else { $null }
}

function Get-ActivationFailure {
  # Motivo curto (PT-BR, sem acento) se o stderr mostra falha de ativacao de plugin; $null se nao.
  $lines = Get-ErrLines
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch $ActivationPattern) { continue }
    $hit = $Matches
    if ($lines[$i] -match 'startup failed:') {
      for ($j = $i + 1; $j -lt [Math]::Min($i + 12, $lines.Count); $j++) {
        if ($lines[$j] -match '^\s{2}(\S+)( \(required\))?\s*$') { return "plugin obrigatorio $($Matches[1]) falhou ao carregar" }
      }
      return 'plugin obrigatorio falhou ao carregar'
    }
    $n = [int]$hit[3]
    $first = if ($i + 1 -lt $lines.Count) { $lines[$i + 1] } else { '' }
    $what = if ($first -match '^(\S+) \((.+?)\): ') { if ($Matches[1] -eq $Matches[2]) { $Matches[1] } else { "$($Matches[1]) ($($Matches[2]))" } } else { '' }
    $more = if ($n -gt 1) { " (+$($n - 1) outro(s))" } else { '' }
    if ($what) { return "plugin $what falhou ao carregar$more" }
    return "$n plugin(s) falharam ao carregar"
  }
  $null
}

function Wait-NormalBoot($p) {
  # $null = boot normal bom (URL impressa, sem falha de ativacao). Senao: o motivo.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    $fail = Get-ActivationFailure
    if ($fail) { return $fail }
    if (Get-ServerUrl) { return $null }
    if ($p.HasExited) {
      $err = (Get-ErrLines) -join "`n"
      if ($err -match 'EADDRINUSE' -and (Test-PortOpen $Port) -and (Open-Existing $Port)) { exit 0 }   # outra instancia ganhou a corrida
      return 'o servidor encerrou antes de abrir (detalhes no log)'
    }
    if ($sw.Elapsed.TotalSeconds -gt 45 -and -not (Test-PortOpen $Port)) { return 'o servidor nao abriu a porta em 45 s' }
    if ($sw.Elapsed.TotalSeconds -gt 90) { return 'o servidor nao terminou de carregar os plugins em 90 s' }
    Start-Sleep -Milliseconds 200
  }
}

function Write-FallbackLog([string]$title, [string]$reason) {
  $lines = Get-ErrLines
  $at = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $ActivationPattern) { $at = $i; break } }
  $block = if ($at -ge 0) { ($lines[$at..([Math]::Min($at + 14, $lines.Count - 1))]) -join "`r`n" } else { '(nenhuma linha de ativacao no stderr)' }
  $tailLines = ($lines | Select-Object -Last 30) -join "`r`n"
  if ((Test-Path $fallbackLog) -and (Get-Item $fallbackLog).Length -gt 200KB) { Remove-Item $fallbackLog -Force }
  Add-Content -Path $fallbackLog -Encoding UTF8 -Value ("=== {0} - {1} ===`r`nmotivo: {2}`r`nporta: {3}  log do servidor: {4}`r`n--- bloco de ativacao (stderr)`r`n{5}`r`n--- ultimas 30 linhas do stderr`r`n{6}`r`n" -f (Get-Date -Format s), $title, $reason, $Port, "$log.err", $block, $tailLines)
}

function Stop-ServerTree($p) {
  # Mata o servidor e os filhos (MCP etc.), esperando a porta liberar para a subida seguinte.
  try { Start-Process taskkill -ArgumentList '/PID', $p.Id, '/T', '/F' -WindowStyle Hidden -Wait } catch {}
  for ($i = 0; $i -lt 50 -and (Test-PortOpen $Port); $i++) { Start-Sleep -Milliseconds 100 }
}

function Start-Server([bool]$safe, [bool]$noOpen, [bool]$simulateFailure, [string]$publicHost) {
  $a = @("`"$bin`"", $Profile)
  if ($safe) { $a += '--safe' }   # flags do launcher: logo apos o profile, antes das flags do app
  if ($simulateFailure) {
    $sim = Join-Path $state 'simular-falha.patch.yml'
    Set-Content -Path $sim -Encoding UTF8 -Value "- insert:`n    - id: simulacao-falha`n      name: '@forge-simulacao/plugin-inexistente'`n"
    $a += @('--patch', "`"$sim`"")
  }
  if ($Profile -eq 'web') {
    if ($Port -ne 3080) { $a += @('--port', $Port) }
    if ($publicHost) { $a += @('--trusted-host', $publicHost) }   # acesso do celular por Tailscale (solo porta 3080)
    if ($noOpen) { $a += '--no-open' }
  }
  Start-Process $node -ArgumentList $a -WorkingDirectory $serverCwd -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
}

# --- 1. Instancia ja no ar? So reaproveita (web) ---------------------------------------------------------------
if ($Profile -eq 'web' -and -not $Atualizar -and (Test-PortOpen $Port)) {
  $forge = Get-ForgeProcs | Where-Object { $_.CommandLine -match '\bweb\b' }
  if ($forge) {
    $runningSafe = [bool]($forge | Where-Object { $_.CommandLine -match '\s--safe(\s|$)' })
    if ($runningSafe -eq [bool]$Safe -and (Open-Existing $Port)) { exit 0 }
    Stop-Forge; Start-Sleep 1   # outro modo (normal x seguro) ou sem token conhecido: reinicia (abaixo) para abrir no modo pedido e autenticado
  } else {
  Show-Toast 'FORGE nao abriu' "A porta $Port esta ocupada por outro programa (nao e o FORGE)."
  exit 1
  }
}

# --- 2. Build: so bloqueia se nao existe ou foi pedido ---------------------------------------------------------
$head = Get-CodeStamp
$stamp = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() }
         elseif (Test-Path $oldStamp) { (Get-Content $oldStamp -Raw).Trim() } else { '' }
if ($Atualizar) { Stop-Forge }
if ($Atualizar -or -not (Test-Path $bin)) {
  Build-Forge
  if (Test-Path $stampFile) { $stamp = (Get-Content $stampFile -Raw).Trim() }
}
if (-not (Test-Path $bin)) { Show-Toast 'FORGE nao abriu' 'Build ausente e a reconstrucao falhou.'; exit 1 }

# --- 3. Sobe escondido (cwd neutro) -----------------------------------------------------------------------------
if ($Profile -eq 'plain') { Stop-Forge }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

# --- 3b. Tailscale (so porta 3080): liga o servidor ao tailnet para o celular ------------------------------------
# O serve web segue em 127.0.0.1:3080 (o schema do plugin webserver so aceita loopback/0.0.0.0);
# Tailscale Serve publica https://<hostname>.ts.net que faz proxy ao loopback, e
# `--trusted-host <hostname>` abre o fence /api para essa authority. Se Tailscale nao esta
# conectado (ou Serve falha), tudo segue igual: so que sen acceso do celular.
$hostPublico = ''
$hostServe = ''
if ($Profile -eq 'web' -and $Port -eq 3080) {
  $tailHost = Get-TailscaleHost
  if ($tailHost) {
    $tailErr = Ensure-Serve $Port
    if ($tailErr) {
      Show-Toast 'FORGE' "$tailErr - abriendo solo local (sen celular)."
    } else {
      $hostPublico = Get-ServeHost
      if (-not $hostPublico) { $hostPublico = $tailHost }
      $hostServe = $hostPublico
    }
  }
}

# Fallback automatico so no web em modo normal. Nele o launcher abre o navegador (so apos o veredito do boot), entao o
# servidor sobe com --no-open; no resto o `dsh web` abre sozinho, como sempre.
$autoFallback = ($Profile -eq 'web' -and -not $Safe)
$proc = Start-Server ([bool]$Safe) ($NoOpen -or $autoFallback) ([bool]$SimularFalha) $hostPublico

# --- 4. Espera subir; detecta corrida (outra instancia ganhou a porta) e falha --------------------------------------
$fellBack = $false
if ($autoFallback) {
  $reason = Wait-NormalBoot $proc
  if ($null -eq $reason) {
    if (-not $NoOpen) { Start-Process (Get-ServerUrl) }   # boot normal bom: so abre o navegador, como o dsh faria
  } else {
    # --- 4b. Fallback: mata, grava o motivo e sobe em modo seguro (uma unica tentativa; sem loop) -------------------
    Write-FallbackLog 'boot normal falhou' $reason
    Stop-ServerTree $proc
    $env:FORGE_SAFE_REASON = $reason
    try { $proc = Start-Server $true ([bool]$NoOpen) $false $hostPublico } finally { Remove-Item Env:\FORGE_SAFE_REASON -ErrorAction SilentlyContinue }
    $fellBack = $true
  }
}
if ($Profile -eq 'web' -and ($fellBack -or -not $autoFallback)) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-PortOpen $Port)) {
    if ($proc.HasExited) {
      $err = (Get-ErrLines) -join "`n"
      if (-not $fellBack -and $err -match 'EADDRINUSE' -and (Test-PortOpen $Port) -and (Open-Existing $Port)) { exit 0 }
      if ($fellBack) {
        Write-FallbackLog 'modo seguro tambem falhou' 'o servidor encerrou em modo seguro'
        Show-Toast 'FORGE nao abriu' "Falhou no modo normal ($reason) e tambem no modo seguro. Veja $fallbackLog"
      } else {
        Show-Toast 'FORGE nao subiu' "O servidor encerrou. Veja $log.err"
      }
      exit 1
    }
    if ($sw.Elapsed.TotalSeconds -gt 90) {
      if ($fellBack) {
        Write-FallbackLog 'modo seguro tambem falhou' 'o servidor nao respondeu em 90 s em modo seguro'
        Stop-ServerTree $proc
        Show-Toast 'FORGE nao abriu' "Falhou no modo normal ($reason) e o modo seguro nao respondeu. Veja $fallbackLog"
      } else {
        Show-Toast 'FORGE demorando' "Nao respondeu em 90s. Veja $log.err"
      }
      exit 1
    }
    Start-Sleep -Milliseconds 100
  }
}
if ($fellBack) {
  $short = if ($reason.Length -gt 150) { $reason.Substring(0, 150) } else { $reason }
  Show-Toast 'FORGE abriu em modo seguro' "$short. Corrija e abra pelo atalho normal."
  exit 0
}

# --- URL para o celular (so com tailnet): reescribe a URL do token ao hostname publico -----------------------------
if ($hostServe) {
  $localUrl = Get-ServerUrl
  if ($localUrl) {
    $remoteUrl = $localUrl.Replace("http://127.0.0.1:$Port", "https://$hostServe")
    Set-Content -Path $urlFile -Encoding UTF8 -Value ($remoteUrl + "`r`n`r`n(Acesso por Tailscale Serve. Abre esta URL no navegador do celular com a app Tailscale logada con a tua conta pessoal -`r`nsolo ela pode alcancar https://$hostServe. O token renova em cada subida: corre FORGE.lnk para atualizar.)")
  }
}

if ($head -ne $stamp) {
  Show-Toast 'FORGE aberto - ha versao nova' 'O codigo do FORGE mudou desde o ultimo build. Para aplicar: feche o FORGE e use o atalho "Atualizar FORGE" (ou atualizar-forge.bat, na pasta do FORGE).'
}
