# Acesso do FORGE pelo celular (via Tailscale): liga e desliga sem reinstalar. Atalho: "FORGE (celular)" na area de trabalho.
#  -Modo Alternar (padrao): mostra o estado e liga ou desliga. Ligar prepara o Tailscale (instalar, entrar na conta,
#     habilitar o Serve) e reinicia o FORGE se ele estiver aberto; desligar remove a publicacao e reinicia igual.
#  -Modo Preparar: so o preparo do Tailscale, chamado pelo instalador (sai com 0 se o celular ficou pronto, 1 se nao).
# A escolha fica em %LOCALAPPDATA%\forge-launch\celular.txt ('on'/'off'); o launcher respeita. Sem Tailscale o FORGE segue
# funcionando so neste computador. Nada aqui depende de pastas da maquina de quem escreveu: tudo e relativo a esta pasta.
param(
  [ValidateSet('Alternar', 'Preparar')][string]$Modo = 'Alternar',
  [switch]$SemPerguntas,   # nao pergunta nada nem abre paginas (testes e instalacao automatica)
  [int]$Porta = 3080       # o acesso pelo celular so funciona na porta padrao
)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$state = Join-Path $env:LOCALAPPDATA 'forge-launch'
$prefFile = Join-Path $state 'celular.txt'
$urlFile = Join-Path $state 'forge-remoto-url.txt'
$bin = Join-Path $dir 'apps\cli\lib\bin.js'
New-Item -ItemType Directory -Force $state | Out-Null

function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }
function Atualizar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Get-Pref { if (Test-Path $prefFile) { (Get-Content $prefFile -Raw).Trim() } else { '' } }
function Set-Pref([string]$v) { Set-Content -Path $prefFile -Value $v -Encoding ASCII }

function Achar-Tailscale {
  if ($env:FORGE_TAILSCALE -and (Test-Path $env:FORGE_TAILSCALE)) { return $env:FORGE_TAILSCALE }   # so para testes
  $c = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
  if ($c) { return $c }
  foreach ($p in @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  $null
}
function Ts([string[]]$a) {
  # Tailscale parado ou sem login escreve no stderr: nunca deixa isso virar erro do script.
  $ErrorActionPreference = 'Continue'
  try { (& $script:ts @a 2>&1 | Out-String) } catch { '' }
}
function Ts-Conectado {
  if (-not $script:ts) { return $false }
  $j = try { (Ts @('status', '--json')) | ConvertFrom-Json } catch { $null }
  [bool]($j -and $j.BackendState -eq 'Running')
}

function Preparar-Celular {
  # Devolve $true quando o Tailscale esta conectado e o Serve configurado.
  $script:ts = Achar-Tailscale
  if (-not $script:ts -and -not $SemPerguntas) {
    $r = Read-Host '   Quer usar o FORGE tambem no celular? Isso instala o Tailscale (gratis). [s/N]'
    if ($r -match '^[sSyY]') {
      if (Get-Command winget -ErrorAction SilentlyContinue) {
        Aviso 'Instalando o Tailscale pelo winget (pode pedir permissao de administrador)...'
        $ErrorActionPreference = 'Continue'
        winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements
        $ErrorActionPreference = 'Stop'
        Atualizar-Path
        $script:ts = Achar-Tailscale
      }
      if (-not $script:ts) { Start-Process 'https://tailscale.com/download'; Aviso 'Instale o Tailscale pelo site que abriu e ligue o celular de novo pelo atalho "FORGE (celular)".' }
    }
  }
  if (-not $script:ts) { Aviso 'Sem Tailscale: o FORGE funciona normalmente neste computador.'; return $false }
  if (-not (Ts-Conectado)) {
    if ($SemPerguntas) { Aviso 'Tailscale desligado ou sem login; seguindo sem celular.' }
    else {
      Aviso 'Abrindo o login do Tailscale no navegador: entre com a MESMA conta que vai usar no celular (ate 3 minutos)...'
      Ts @('up', '--timeout', '180s') | Out-Null
    }
  }
  if (-not (Ts-Conectado)) { Aviso 'O Tailscale nao conectou. Abra o app Tailscale, entre na conta e use o atalho "FORGE (celular)" de novo.'; return $false }
  if ($Porta -ne 3080) { Aviso 'Porta diferente de 3080: o acesso pelo celular so funciona na porta padrao.'; return $false }
  $saida = Ts @('serve', '--bg', '3080')
  if ($saida -match 'not enabled|enable') {
    $link = [regex]::Match($saida, 'https://login\.tailscale\.com/\S+').Value
    if (-not $link) { $link = 'https://login.tailscale.com/f/serve' }
    Aviso 'O recurso "Serve" precisa ser habilitado uma vez na sua conta Tailscale.'
    if ($SemPerguntas) { Aviso "Habilite em $link e tente de novo." }
    else { Aviso 'Abri a pagina; clique em Enable.'; Start-Process $link; Read-Host '   Quando terminar, aperte Enter' | Out-Null }
    $saida = Ts @('serve', '--bg', '3080')
  }
  if ($saida -match 'not enabled') { Aviso 'O Serve ainda nao esta habilitado; use o atalho "FORGE (celular)" de novo depois de habilitar.'; return $false }
  Ok 'Tailscale conectado e Serve configurado.'
  $true
}

function Get-ForgeProcs {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($bin) }
}

function Reabrir-Forge([bool]$estavaAberto) {
  if (-not $estavaAberto) { Write-Host '   Abra o FORGE pelo atalho para valer.'; return }
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'launch-forge.ps1'), 'web', '-Reiniciar', '-Port', $Porta)
  if ($SemPerguntas) { $a += '-NoOpen' }
  & powershell @a
}

if ($Modo -eq 'Preparar') {
  $pronto = Preparar-Celular
  Set-Pref $(if ($pronto) { 'on' } else { 'off' })
  exit $(if ($pronto) { 0 } else { 1 })
}

# --- Alternar ---------------------------------------------------------------------------------------------------------
$script:ts = Achar-Tailscale
$pref = Get-Pref
$ligado = ($pref -eq 'on') -or ($pref -eq '' -and (Ts-Conectado))
$aberto = [bool](Get-ForgeProcs)
Write-Host ''
Write-Host ('Acesso pelo celular: ' + $(if ($ligado) { 'LIGADO' } else { 'DESLIGADO' })) -ForegroundColor Cyan
if ($aberto) { Aviso 'O FORGE esta aberto: sera reiniciado e qualquer sessao em andamento sera interrompida.' }
if (-not $SemPerguntas) {
  $r = Read-Host ('   ' + $(if ($ligado) { 'Desligar' } else { 'Ligar' }) + '? [S/n]')
  if ($r -match '^[nN]') { Write-Host '   Nada mudou.'; exit 0 }
}

if ($ligado) {
  Set-Pref 'off'
  if ($script:ts) { Ts @('serve', 'reset') | Out-Null }
  Remove-Item $urlFile -Force -ErrorAction SilentlyContinue
  Ok 'Acesso pelo celular desligado.'
  & (Join-Path $dir 'install-forge-shortcut.ps1') | Out-Null   # sem -ComCelular: remove o atalho do link
  Reabrir-Forge $aberto
} else {
  if (Preparar-Celular) {
    Set-Pref 'on'
    Reabrir-Forge $aberto
    Write-Host ''
    Ok 'Acesso pelo celular ligado.'
    Write-Host '   No celular: app Tailscale na mesma conta. No PC: abra o atalho "FORGE (link do celular)" e use o link no celular.'
    Write-Host '   O link muda a cada vez que o FORGE inicia.'
    & (Join-Path $dir 'install-forge-shortcut.ps1') -ComCelular | Out-Null
  } else {
    Set-Pref 'off'
  }
}
