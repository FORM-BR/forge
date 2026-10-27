# Prepara o Tailscale para o acesso do FORGE pelo celular: oferece instalar (winget), abre o login e habilita o Serve.
# Chamado pelo instalador (instalar-forge.ps1). Sai com 0 quando o celular ficou pronto e deixa o interruptor ligado
# (arquivo remote-access na pasta do Harness, que o FORGE le ao subir); sai com 1 quando nao ficou, sem alterar nada.
# Depois da instalacao, ligar e desligar o acesso pelo celular e feito DENTRO do FORGE: Configuracoes > Geral > Acesso pelo celular.
# Sem Tailscale o FORGE funciona normalmente neste computador. Nada aqui depende de pastas de quem escreveu.
param(
  [switch]$SemPerguntas   # nao pergunta nada nem abre paginas (testes e instalacao automatica)
)
$ErrorActionPreference = 'Stop'

function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }
function Atualizar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

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
    if (-not $script:ts) { Start-Process 'https://tailscale.com/download'; Aviso 'Instale o Tailscale pelo site que abriu; depois ligue o celular dentro do FORGE (Configuracoes > Geral).' }
  }
}
if (-not $script:ts) { Aviso 'Sem Tailscale: o FORGE funciona normalmente neste computador.'; exit 1 }

if (-not (Ts-Conectado)) {
  if ($SemPerguntas) { Aviso 'Tailscale desligado ou sem login; seguindo sem celular.' }
  else {
    Aviso 'Abrindo o login do Tailscale no navegador: entre com a MESMA conta que vai usar no celular (ate 3 minutos)...'
    Ts @('up', '--timeout', '180s') | Out-Null
  }
}
if (-not (Ts-Conectado)) { Aviso 'O Tailscale nao conectou. Entre na conta pelo app Tailscale e ligue o celular dentro do FORGE (Configuracoes > Geral).'; exit 1 }

# O FORGE publica o proprio servidor ao ligar o interruptor; aqui so conferimos que o Serve esta habilitado na conta.
$saida = Ts @('serve', '--bg', '3080')
if ($saida -match 'not enabled|enable') {
  $link = [regex]::Match($saida, 'https://login\.tailscale\.com/\S+').Value
  if (-not $link) { $link = 'https://login.tailscale.com/f/serve' }
  Aviso 'O recurso "Serve" precisa ser habilitado uma vez na sua conta Tailscale.'
  if ($SemPerguntas) { Aviso "Habilite em $link e ligue o celular dentro do FORGE depois." }
  else { Aviso 'Abri a pagina; clique em Enable.'; Start-Process $link; Read-Host '   Quando terminar, aperte Enter' | Out-Null }
  $saida = Ts @('serve', '--bg', '3080')
}
if ($saida -match 'not enabled') { Aviso 'O Serve ainda nao esta habilitado; habilite e ligue o celular dentro do FORGE depois.'; exit 1 }

$home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
New-Item -ItemType Directory -Force $home_ | Out-Null
Set-Content -Path (Join-Path $home_ 'remote-access') -Value 'on' -Encoding ASCII
Ok 'Tailscale pronto. O acesso pelo celular vai ligar sozinho quando o FORGE abrir (e voce desliga em Configuracoes > Geral).'
exit 0
