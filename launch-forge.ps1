param([Parameter(Mandatory)][ValidateSet('web','plain')][string]$Profile)
# Abre o FORGE (web) ou o dsh puro (plain): fecha instancia antiga, reconstroi se o repo mudou, sobe escondido e abre o navegador.
$r = 'C:\Users\Felipe\Dev\deepseek-harness'
$log = Join-Path $env:LOCALAPPDATA "forge-launch-$Profile.log"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'apps\\cli\\lib\\bin\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Set-Location $r
$stampFile = Join-Path $r '.launch-build-stamp'
$head = (git rev-parse HEAD).Trim()
$stamp = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }
if ($head -ne $stamp -or -not (Test-Path 'apps\cli\lib\bin.js')) {
  $cmd = '$Host.UI.RawUI.WindowTitle="Atualizando FORGE - aguarde"; cd "' + $r + '"; ' +
    'pnpm install --frozen-lockfile; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:lib:host; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:lib:client; if($LASTEXITCODE){exit 1}; ' +
    'pnpm run build:web; exit $LASTEXITCODE'
  $p = Start-Process powershell -ArgumentList '-NoProfile','-Command',$cmd -Wait -PassThru
  if ($p.ExitCode -eq 0) { Set-Content $stampFile $head } else { Write-Warning 'Falha ao reconstruir; tentando abrir mesmo assim.'; Start-Sleep 5 }
}
Start-Process node -ArgumentList 'apps\cli\lib\bin.js',$Profile -WorkingDirectory $r -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"