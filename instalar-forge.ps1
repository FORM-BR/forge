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
# Vem ANTES do build para o login (que abre o navegador) acontecer enquanto voce esta na frente do computador. O launcher
# repete a configuracao do Serve a cada subida, entao aqui so preparamos: instalar, entrar na conta, habilitar o Serve.
Titulo '3/5 Tailscale (opcional: usar o FORGE no celular)'
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
  # Tailscale parado ou sem login escreve no stderr: nunca deixa isso virar erro do instalador.
  $ErrorActionPreference = 'Continue'
  try { (& $script:ts @a 2>&1 | Out-String) } catch { '' }
}
function Ts-Conectado {
  $j = try { (Ts @('status', '--json')) | ConvertFrom-Json } catch { $null }
  [bool]($j -and $j.BackendState -eq 'Running')
}
$ts = Achar-Tailscale
if (-not $ts -and -not $SemPerguntas) {
  $r = Read-Host '   Quer usar o FORGE tambem no celular? Isso instala o Tailscale (gratis). [s/N]'
  if ($r -match '^[sSyY]') {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Aviso 'Instalando o Tailscale pelo winget (pode pedir permissao de administrador)...'
      $ErrorActionPreference = 'Continue'
      winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements
      $ErrorActionPreference = 'Stop'
      Atualizar-Path
      $ts = Achar-Tailscale
    }
    if (-not $ts) { Start-Process 'https://tailscale.com/download'; Aviso 'Instale o Tailscale pelo site que abriu e rode este instalador de novo.' }
  }
}
$celularPronto = $false
if (-not $ts) {
  Aviso 'Sem Tailscale: o FORGE funciona normalmente neste computador (para o celular, rode este instalador de novo).'
} else {
  if (-not (Ts-Conectado)) {
    if ($SemPerguntas) { Aviso 'Tailscale desligado ou sem login; seguindo sem celular.' }
    else {
      Aviso 'Abrindo o login do Tailscale no navegador: entre com a MESMA conta que vai usar no celular (ate 3 minutos)...'
      Ts @('up', '--timeout', '180s') | Out-Null
    }
  }
  if (Ts-Conectado) {
    if ($Porta -ne 3080) { Aviso 'Porta diferente de 3080: o acesso pelo celular so funciona na porta padrao.' }
    else {
      $saida = Ts @('serve', '--bg', '3080')
      if ($saida -match 'not enabled|enable') {
        $link = [regex]::Match($saida, 'https://login\.tailscale\.com/\S+').Value
        if (-not $link) { $link = 'https://login.tailscale.com/f/serve' }
        Aviso 'O recurso "Serve" precisa ser habilitado uma vez na sua conta Tailscale. Abri a pagina; clique em Enable.'
        if (-not $SemPerguntas) { Start-Process $link; Read-Host '   Quando terminar, aperte Enter' | Out-Null }
        $saida = Ts @('serve', '--bg', '3080')
      }
      if ($saida -match 'not enabled') { Aviso 'O Serve ainda nao esta habilitado; rode este instalador de novo depois de habilitar.' }
      else { $celularPronto = $true; Ok 'Tailscale conectado e Serve configurado.' }
    }
  } else {
    Aviso 'O Tailscale nao conectou. Abra o app Tailscale, entre na conta e rode este instalador de novo.'
  }
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
# O arquivo com o link nasce quando o FORGE sobe com o Tailscale ligado; o atalho so o abre.
$comCelular = $celularPronto
if ($comCelular) { & (Join-Path $dir 'install-forge-shortcut.ps1') -ComCelular | Out-Null } else { & (Join-Path $dir 'install-forge-shortcut.ps1') | Out-Null }
Ok 'Atalhos criados: FORGE, FORGE (modo seguro), Atualizar FORGE.'

if ($comCelular) {
  Write-Host ''
  Ok 'Celular pronto:'
  Write-Host '   1. Instale o app Tailscale no celular e entre na MESMA conta.'
  Write-Host '   2. No PC, abra o atalho "FORGE (link do celular)" e abra o link que aparece no navegador do celular.'
  Write-Host '   O link muda a cada vez que o FORGE inicia (o token renova): pegue o link de novo no mesmo atalho.'
} elseif ($ts) {
  Write-Host ''
  Aviso 'O celular ainda nao esta ligado. Resolva o que foi dito no passo 3 e rode este instalador de novo (e rapido: nao refaz o que ja esta pronto).'
}

Write-Host ''
Write-Host 'Pronto. Abra o FORGE pelo atalho na area de trabalho.' -ForegroundColor Green
Write-Host 'Na primeira vez, configure sua chave de API do modelo (ex.: Anthropic) na tela de modelos/provedores do app.'
