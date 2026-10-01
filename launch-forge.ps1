param(
  [Parameter(Mandatory)][ValidateSet('web','plain')][string]$Profile,
  [int]$Port = 3080,        # porta do `dsh web`; so e repassada ao servidor se diferente de 3080
  [switch]$NoOpen,          # nao abre o navegador (testes)
  [switch]$Atualizar        # reconstroi agora (janela visivel) mesmo que o build pareca em dia
)
# Abre o FORGE rapido e sem janela: usa o build compilado (apps\cli\lib\bin.js), sobe o servidor escondido
# e deixa o proprio `dsh web` abrir o navegador (ele imprime/abre a URL com o token).
#  - ja existe instancia na porta: so abre o navegador nela (nada de matar, nada de EADDRINUSE);
#  - build defasado (master mudou): abre mesmo assim e avisa com um balao; `-Atualizar` reconstroi;
#  - o servidor roda com cwd num diretorio neutro, NUNCA na raiz do repo (o sandbox do Forge marca o cwd
#    com integridade Low e isso quebrou os hooks do git; ver Vault-IA/geral/Forge - sandbox Windows ...).
$ErrorActionPreference = 'Stop'
$r = 'C:\Users\Felipe\Dev\deepseek-harness'
$serverCwd = 'C:\Users\Felipe\Dev\forge-tasks\server-cwd'
$state = Join-Path $env:LOCALAPPDATA 'forge-launch'
# Um log por porta: uma subida de teste/corrida nao pode apagar o log (com o token) da instancia que esta no ar.
$log = Join-Path $env:LOCALAPPDATA $(if ($Port -eq 3080) { "forge-launch-$Profile.log" } else { "forge-launch-$Profile-$Port.log" })
$bin = Join-Path $r 'apps\cli\lib\bin.js'
$stampFile = Join-Path $state 'build-stamp'
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

# --- 1. Instancia ja no ar? So reaproveita (web) ---------------------------------------------------------------
if ($Profile -eq 'web' -and -not $Atualizar -and (Test-PortOpen $Port)) {
  $forge = Get-ForgeProcs | Where-Object { $_.CommandLine -match '\bweb\b' }
  if ($forge) {
    if (Open-Existing $Port) { exit 0 }
    Stop-Forge; Start-Sleep 1   # sem token conhecido: reinicia (abaixo) para o navegador abrir autenticado
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
$argList = @("`"$bin`"", $Profile)
if ($Profile -eq 'web') {
  if ($Port -ne 3080) { $argList += @('--port', $Port) }
  if ($NoOpen) { $argList += '--no-open' }
}
$proc = Start-Process $node -ArgumentList $argList -WorkingDirectory $serverCwd -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"

# --- 4. Espera subir; detecta corrida (outra instancia ganhou a porta) e falha --------------------------------------
if ($Profile -eq 'web') {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-PortOpen $Port)) {
    if ($proc.HasExited) {
      $err = if (Test-Path "$log.err") { Get-Content "$log.err" -Raw } else { '' }
      if ($err -match 'EADDRINUSE' -and (Test-PortOpen $Port) -and (Open-Existing $Port)) { exit 0 }
      Show-Toast 'FORGE nao subiu' "O servidor encerrou. Veja $log.err"
      exit 1
    }
    if ($sw.Elapsed.TotalSeconds -gt 90) { Show-Toast 'FORGE demorando' "Nao respondeu em 90s. Veja $log.err"; exit 1 }
    Start-Sleep -Milliseconds 100
  }
}

if ($head -ne $stamp) {
  Show-Toast 'FORGE aberto - ha versao nova' 'O codigo do FORGE mudou desde o ultimo build. Para aplicar: feche o FORGE e rode atualizar-forge.bat (pasta do repo).'
}
