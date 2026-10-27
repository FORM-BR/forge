# Instalador do FORGE para Windows (use "Instalar FORGE.bat", duplo clique). Idempotente: pode rodar de novo.
#  1. Node.js (>= 22.19): se faltar, instala pelo winget (ou manda baixar em nodejs.org);
#  2. pnpm (versao do package.json): se faltar, instala com npm (sem admin);
#  3. Tailscale (OPCIONAL, so para abrir o FORGE no celular): oferece instalar (winget), abre o login, habilita o Serve;
#     sem Tailscale, ou se voce disser nao, o resto funciona igual;
#  4. build do FORGE (pnpm install + builds) e primeira subida, pelo launch-forge.ps1 (janela visivel, alguns minutos);
#  5. atalhos na area de trabalho (FORGE, modo seguro, Atualizar e, com celular pronto, FORGE (link do celular)).
# Tudo que depende do usuario (login do Tailscale, chave de API do modelo) e feito no proprio app depois.
param(
  [switch]$SemAbrir,     # nao abre o navegador no fim (testes)
  [int]$Porta = 3080,    # porta do servidor (so mude para testes; o acesso pelo celular so funciona na 3080)
  [switch]$SemPerguntas, # nao pergunta nada nem abre paginas (testes e instalacao automatica)
  [switch]$SoTailscale   # so prepara o Tailscale (passo 3) e os atalhos; nao constroi nem sobe o FORGE (testes)
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

# --- 3. Tailscale (opcional) ------------------------------------------------------------------------------------------
# Vem ANTES do build para o login (que abre o navegador) acontecer enquanto voce esta na frente do computador. A logica e
# do preparar-celular.ps1. Depois, ligar e desligar o acesso pelo celular e feito DENTRO do FORGE (Configuracoes > Geral).
Titulo '3/5 Tailscale (opcional: usar o FORGE no celular)'
$celularPronto = $false
if ($Porta -ne 3080) { Aviso 'Porta diferente de 3080: o acesso pelo celular so funciona na porta padrao.' }
else {
  $args3t = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'preparar-celular.ps1'))
  if ($SemPerguntas) { $args3t += '-SemPerguntas' }
  & powershell @args3t
  $celularPronto = ($LASTEXITCODE -eq 0)
}

# --- 4. Build + primeira subida ---------------------------------------------------------------------------------------
if ($SoTailscale) {
  Titulo '4/5 Build e subida: pulados (-SoTailscale)'
} else {
  # Rodar de novo e rapido: com o build ja feito o launcher so sobe o servidor (e reaproveita o que ja esta no ar).
  $jaConstruido = Test-Path (Join-Path $dir 'apps\cli\lib\bin.js')
  Titulo $(if ($jaConstruido) { '4/5 Abrindo o FORGE (o build ja existe)' } else { '4/5 Construindo o FORGE (alguns minutos na primeira vez; uma janela de progresso vai abrir)' })
  $args3 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'launch-forge.ps1'), 'web', '-Port', $Porta)
  if (-not $jaConstruido) { $args3 += '-Atualizar' }
  if ($SemAbrir) { $args3 += '-NoOpen' }
  & powershell @args3
  if ($LASTEXITCODE -ne 0) { Parar "O FORGE nao subiu. Veja os logs em $env:LOCALAPPDATA (forge-launch-web.log.err) e rode de novo." }
  Ok 'FORGE no ar.'
}

# --- 5. Atalhos -------------------------------------------------------------------------------------------------------
Titulo '5/5 Atalhos na area de trabalho'
& (Join-Path $dir 'install-forge-shortcut.ps1') | Out-Null
Ok 'Atalhos criados: FORGE, FORGE (modo seguro), Atualizar FORGE.'

if ($celularPronto) {
  Write-Host ''
  Ok 'Celular pronto: o acesso liga sozinho quando o FORGE abrir. O link para o celular fica em Configuracoes > Geral > Acesso pelo celular.'
  Write-Host '   No celular: instale o app Tailscale e entre na MESMA conta; depois abra o link mostrado ali.'
} else {
  Write-Host ''
  Write-Host '   Acesso pelo celular desligado. Para ligar depois, sem reinstalar: Configuracoes > Geral > Acesso pelo celular, dentro do FORGE.'
}

Write-Host ''
Write-Host 'Pronto. Abra o FORGE pelo atalho na area de trabalho.' -ForegroundColor Green
Write-Host 'Na primeira vez, configure sua chave de API do modelo (ex.: Anthropic) na tela de modelos/provedores do app.'
