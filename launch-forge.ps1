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
$r = if ($env:FORGE_REPO_ROOT) { $env:FORGE_REPO_ROOT } else { 'C:\Users\Felipe\Dev\deepseek-harness' }   # FORGE_REPO_ROOT: so para testar outra worktree
$serverCwd = 'C:\Users\Felipe\Dev\forge-tasks\server-cwd'
$state = Join-Path $env:LOCALAPPDATA 'forge-launch'
# Um log por porta: uma subida de teste/corrida nao pode apagar o log (com o token) da instancia que esta no ar.
$log = Join-Path $env:LOCALAPPDATA $(if ($Port -eq 3080) { "forge-launch-$Profile.log" } else { "forge-launch-$Profile-$Port.log" })
$bin = Join-Path $r 'apps\cli\lib\bin.js'
$stampFile = Join-Path $state 'build-stamp'
$fallbackLog = Join-Path $serverCwd 'forge-safe-fallback.log'
$oldStamp = Join-Path $r '.launch-build-stamp'
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

function Build-Forge {
  # Janela visivel de proposito: e o caminho lento (so primeira vez, `-Atualizar` ou lib ausente).
  Set-Location $r
  $head = (git rev-parse HEAD).Trim()
  $cmd = '$Host.UI.RawUI.WindowTitle="Atualizando FORGE - aguarde"; cd "' + $r + '"; ' +
    'pnpm install --frozen-lockfile; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:lib:host; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:lib:client; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:web; exit $LASTEXITCODE'
  $p = Start-Process powershell -ArgumentList '-NoProfile', '-Command', $cmd -Wait -PassThru
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

function Start-Server([bool]$safe, [bool]$noOpen, [bool]$simulateFailure) {
  $a = @("`"$bin`"", $Profile)
  if ($safe) { $a += '--safe' }   # flags do launcher: logo apos o profile, antes das flags do app
  if ($simulateFailure) {
    $sim = Join-Path $state 'simular-falha.patch.yml'
    Set-Content -Path $sim -Encoding UTF8 -Value "- insert:`n    - id: simulacao-falha`n      name: '@forge-simulacao/plugin-inexistente'`n"
    $a += @('--patch', "`"$sim`"")
  }
  if ($Profile -eq 'web') {
    if ($Port -ne 3080) { $a += @('--port', $Port) }
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
$head = (git -C $r rev-parse HEAD).Trim()
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
# Fallback automatico so no web em modo normal. Nele o launcher abre o navegador (so apos o veredito do boot), entao o
# servidor sobe com --no-open; no resto o `dsh web` abre sozinho, como sempre.
$autoFallback = ($Profile -eq 'web' -and -not $Safe)
$proc = Start-Server ([bool]$Safe) ($NoOpen -or $autoFallback) ([bool]$SimularFalha)

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
    try { $proc = Start-Server $true ([bool]$NoOpen) $false } finally { Remove-Item Env:\FORGE_SAFE_REASON -ErrorAction SilentlyContinue }
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

if ($head -ne $stamp) {
  Show-Toast 'FORGE aberto - ha versao nova' 'O codigo do FORGE mudou desde o ultimo build. Para aplicar: feche o FORGE e rode atualizar-forge.bat (pasta do repo).'
}
