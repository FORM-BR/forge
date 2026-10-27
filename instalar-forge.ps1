# Instalador do FORGE para Windows (use "Instalar FORGE.bat", duplo clique). Idempotente: pode rodar de novo.
#  1. Node.js (>= 22.19): se faltar, instala pelo winget (ou manda baixar em nodejs.org);
#  2. pnpm (versao do package.json): se faltar, instala com npm (sem admin);
#  3. build do FORGE (pnpm install + builds) e primeira subida, pelo launch-forge.ps1 (janela visivel, alguns minutos);
#  4. atalhos na area de trabalho (FORGE, modo seguro, Atualizar);
#  5. Tailscale (OPCIONAL, so para abrir o FORGE no celular): se estiver instalado e logado, o proprio launcher configura
#     o Tailscale Serve a cada subida e este instalador cria o atalho do link do celular; se nao, o resto funciona igual.
# Tudo que depende do usuario (login do Tailscale, chave de API do modelo) e feito no proprio app depois.
param(
  [switch]$SemAbrir,     # nao abre o navegador no fim (testes)
  [int]$Porta = 3080     # porta do servidor (so mude para testes; o acesso pelo celular so funciona na 3080)
)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

function Titulo([string]$t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }
function Parar([string]$t) { Write-Host ''; Write-Host "[ERRO] $t" -ForegroundColor Red; exit 1 }
function Atualizar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

$pkg = Get-Content (Join-Path $dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$pnpmVersao = ($pkg.packageManager -replace '^pnpm@', '')

Write-Host 'Instalador do FORGE' -ForegroundColor White
Write-Host "Pasta: $dir"
if ($dir -match 'OneDrive') { Aviso 'Esta pasta esta dentro do OneDrive. Prefira uma pasta local (ex.: C:\FORGE) - o OneDrive deixa o build lento e pode corromper arquivos.' }

# --- 1. Node.js -----------------------------------------------------------------------------------------------------
Titulo '1/5 Node.js'
function Node-Ok {
  $v = (& node -v 2>$null)
  if (-not $v) { return $false }
  $m = [regex]::Match($v, '^v(\d+)\.(\d+)')
  $maj = [int]$m.Groups[1].Value; $min = [int]$m.Groups[2].Value
  return ($maj -ge 24) -or ($maj -eq 22 -and $min -ge 19)
}
$ErrorActionPreference = 'Continue'
if (-not (Node-Ok)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Aviso 'Node.js nao encontrado (ou muito antigo). Instalando o Node.js LTS pelo winget (pode pedir permissao de administrador)...'
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    Atualizar-Path
  }
  if (-not (Node-Ok)) {
    Start-Process 'https://nodejs.org/en/download'
    Parar 'Instale o Node.js LTS (nodejs.org, versao 22.19 ou mais nova), feche esta janela e rode "Instalar FORGE.bat" de novo.'
  }
}
Ok ("Node " + (& node -v))

# --- 2. pnpm --------------------------------------------------------------------------------------------------------
Titulo "2/5 pnpm $pnpmVersao"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Aviso 'pnpm nao encontrado. Instalando com npm...'
  npm install -g "pnpm@$pnpmVersao"
  $prefixo = (& npm prefix -g).Trim()
  if ($prefixo) { $env:Path = "$prefixo;$env:Path" }
  Atualizar-Path
  if ($prefixo) { $env:Path = "$prefixo;$env:Path" }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Parar 'Nao consegui instalar o pnpm. Abra um terminal e rode: npm install -g pnpm' }
Ok ("pnpm " + (& pnpm -v))
$ErrorActionPreference = 'Stop'

# --- 3. Build + primeira subida ---------------------------------------------------------------------------------------
Titulo '3/5 Construindo o FORGE (alguns minutos na primeira vez; uma janela de progresso vai abrir)'
Remove-Item (Join-Path $env:LOCALAPPDATA 'forge-launch\forge-remoto-url.txt') -Force -ErrorAction SilentlyContinue
$args3 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'launch-forge.ps1'), 'web', '-Atualizar', '-Port', $Porta)
if ($SemAbrir) { $args3 += '-NoOpen' }
& powershell @args3
if ($LASTEXITCODE -ne 0) { Parar "O FORGE nao subiu. Veja os logs em $env:LOCALAPPDATA (forge-launch-web.log.err) e rode de novo." }
Ok 'FORGE no ar.'

# --- 4. Atalhos -------------------------------------------------------------------------------------------------------
Titulo '4/5 Atalhos na area de trabalho'
$ts = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
if (-not $ts -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) { $ts = 'C:\Program Files\Tailscale\tailscale.exe' }
$urlCelular = Join-Path $env:LOCALAPPDATA 'forge-launch\forge-remoto-url.txt'
$comCelular = [bool]($ts -and (Test-Path $urlCelular))
if ($comCelular) { & (Join-Path $dir 'install-forge-shortcut.ps1') -ComCelular | Out-Null } else { & (Join-Path $dir 'install-forge-shortcut.ps1') | Out-Null }
Ok 'Atalhos criados: FORGE, FORGE (modo seguro), Atualizar FORGE.'

# --- 5. Tailscale (opcional) ------------------------------------------------------------------------------------------
Titulo '5/5 Tailscale (opcional: abrir o FORGE no celular)'
if (-not $ts) {
  Aviso 'Tailscale nao esta instalado - tudo bem, o FORGE funciona normalmente neste computador.'
  Write-Host '   Se quiser usar no celular: instale em https://tailscale.com/download (PC e celular, mesma conta),'
  Write-Host '   faca login e abra o FORGE de novo pelo atalho: ele se configura sozinho.'
} elseif ($comCelular) {
  Ok 'Tailscale ativo: o acesso pelo celular foi configurado.'
  Write-Host '   Abra o atalho "FORGE (link do celular)" para ver o link; no celular, use o app Tailscale logado na mesma conta.'
  Write-Host '   O link muda a cada vez que o FORGE inicia (o token renova): pegue o link de novo no mesmo atalho.'
} else {
  Aviso 'Tailscale esta instalado, mas desligado ou sem login (ou o recurso Serve nao esta habilitado na sua conta).'
  Write-Host '   Abra o Tailscale, faca login e, se pedir, habilite o "Serve" em https://login.tailscale.com/f/serve .'
  Write-Host '   Depois feche e abra o FORGE pelo atalho: o acesso pelo celular se configura sozinho, e o atalho "FORGE (link do celular)" aparece ao rodar este instalador de novo.'
}

Write-Host ''
Write-Host 'Pronto. Abra o FORGE pelo atalho na area de trabalho.' -ForegroundColor Green
Write-Host 'Na primeira vez, configure sua chave de API do modelo (ex.: Anthropic) na tela de modelos/provedores do app.'
