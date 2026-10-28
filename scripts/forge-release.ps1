#Requires -Version 5.1
<#
.SYNOPSIS
  Prepara uma release do FORGE: confere a arvore, decide a proxima versao semver
  com sufixo do fork, roda os gates minimos e cria a tag local. Nunca da push:
  imprime o comando exato para o Felipe rodar manualmente.

.DESCRIPTION
  Fluxo:
    1. confere que a arvore de trabalho esta limpa (sem staged/unstaged/untracked
       relevante) e que HEAD esta na branch esperada;
    2. le a versao atual de apps/desktop/package.json e calcula a proxima versao
       semver com o sufixo de fork "-forge.N" (ex.: 0.3.0-forge.1 -> 0.3.0-forge.2),
       ou aceita uma versao explicita via -Version;
    3. escreve a nova versao em apps/desktop/package.json (e no package.json raiz,
       se -BumpRoot for passado) e comita essa mudanca isolada;
    4. roda os gates minimos (typecheck do pacote desktop + testes do pacote
       desktop) — nao a suite inteira;
    5. cria a tag anotada "v<versao>" apontando para o commit de bump;
    6. imprime (sem executar) o comando "git push forge v<versao>" e o comando de
       push da branch, para o Felipe decidir e rodar.

  Nao faz push, nao cria PR, nao muda visibilidade do repo, nao publica release.

.PARAMETER Version
  Versao semver explicita (ex.: "0.3.0-forge.1"). Se omitida, incrementa o ultimo
  numero depois de "-forge." na versao atual de apps/desktop/package.json (ou
  comeca em "<versao-atual>-forge.1" se a versao atual nao tiver esse sufixo).

.PARAMETER BumpRoot
  Tambem atualiza a versao do package.json raiz (@deepseek-ai/dsh-root) para o
  mesmo valor. Por padrao so apps/desktop/package.json e atualizado, pois e a
  versao que chega ao instalador e ao electron-updater.

.PARAMETER SkipGates
  Pula a etapa de gates minimos (typecheck + testes do pacote desktop). Use
  apenas para iterar no proprio script; uma release real deve rodar os gates.

.PARAMETER Remote
  Nome do remote git usado so para compor o comando de push sugerido no final
  (nao e usado para nenhuma operacao de rede). Padrao: "forge".

.EXAMPLE
  pwsh -File scripts/forge-release.ps1
  Calcula a proxima versao de fork automaticamente, roda os gates e cria a tag.

.EXAMPLE
  pwsh -File scripts/forge-release.ps1 -Version 0.3.0-forge.1
  Usa uma versao explicita.
#>
param(
  [string]$Version,
  [switch]$BumpRoot,
  [switch]$SkipGates,
  [string]$Remote = 'forge'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw "forge-release: rode este script de dentro de um checkout git." }
Set-Location $repoRoot

function Secao([string]$texto) {
  Write-Host ""
  Write-Host "== $texto ==" -ForegroundColor Cyan
}

# 1. Arvore limpa
Secao "Conferindo a arvore de trabalho"
$status = git status --porcelain
if ($status) {
  Write-Host $status
  throw "forge-release: a arvore de trabalho nao esta limpa. Comite ou descarte as mudancas acima antes de gerar uma release."
}
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Branch atual: $branch"
Write-Host "Arvore limpa."

# 2. Versao atual e proxima versao
Secao "Resolvendo a versao"
$desktopPkgPath = Join-Path $repoRoot 'apps/desktop/package.json'
$desktopPkg = Get-Content $desktopPkgPath -Raw | ConvertFrom-Json
$currentVersion = $desktopPkg.version
Write-Host "Versao atual (apps/desktop/package.json): $currentVersion"

if (-not $Version) {
  if ($currentVersion -match '^(?<base>.+)-forge\.(?<n>\d+)$') {
    $base = $Matches['base']
    $next = [int]$Matches['n'] + 1
    $Version = "$base-forge.$next"
  } else {
    $Version = "$currentVersion-forge.1"
  }
  Write-Host "Proxima versao calculada: $Version"
} else {
  Write-Host "Versao explicita informada: $Version"
}

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  throw "forge-release: '$Version' nao parece um semver valido (ex.: 0.3.0-forge.1)."
}

$tagName = "v$Version"
$existingTag = git tag --list $tagName
if ($existingTag) {
  throw "forge-release: a tag '$tagName' ja existe localmente. Escolha outra versao ou apague a tag antiga (git tag -d $tagName) se foi um engano."
}

# 3. Escrever a nova versao e comitar
Secao "Atualizando a versao"
$desktopPkg.version = $Version
($desktopPkg | ConvertTo-Json -Depth 100) | Set-Content -Path $desktopPkgPath -Encoding utf8
$filesToAdd = @('apps/desktop/package.json')

if ($BumpRoot) {
  $rootPkgPath = Join-Path $repoRoot 'package.json'
  $rootPkg = Get-Content $rootPkgPath -Raw | ConvertFrom-Json
  $rootPkg.version = $Version
  ($rootPkg | ConvertTo-Json -Depth 100) | Set-Content -Path $rootPkgPath -Encoding utf8
  $filesToAdd += 'package.json'
}

git add -- $filesToAdd
git commit -m "chore(release): versao $Version" | Out-Null
$bumpCommit = git rev-parse --short HEAD
Write-Host "Commit de bump criado: $bumpCommit"

# 4. Gates minimos
if (-not $SkipGates) {
  Secao "Rodando gates minimos (typecheck + testes do pacote desktop)"
  pnpm exec tsc -b apps/desktop
  if ($LASTEXITCODE -ne 0) { throw "forge-release: typecheck do apps/desktop falhou (exit $LASTEXITCODE)." }
  pnpm exec vitest run apps/desktop
  if ($LASTEXITCODE -ne 0) { throw "forge-release: testes do apps/desktop falharam (exit $LASTEXITCODE)." }
  Write-Host "Gates minimos passaram."
} else {
  Secao "Gates minimos pulados (-SkipGates)"
}

# 5. Tag anotada
Secao "Criando a tag"
git tag -a $tagName -m "FORGE $Version"
Write-Host "Tag '$tagName' criada localmente, apontando para $bumpCommit."

# 6. Nada de push: so imprime os comandos
Secao "Proximo passo (NAO executado por este script)"
Write-Host "Revise o commit de bump e a tag, depois rode manualmente:" -ForegroundColor Yellow
Write-Host "  git push $Remote $branch" -ForegroundColor Yellow
Write-Host "  git push $Remote $tagName" -ForegroundColor Yellow
Write-Host ""
Write-Host "O push da tag 'v*' e o que dispara o workflow .github/workflows/forge-release.yml" -ForegroundColor Yellow
Write-Host "(build Desktop + NSIS no windows-latest, publicacao da Release com artefatos e latest.yml)." -ForegroundColor Yellow
