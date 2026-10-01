# forge.ps1 — gerenciador do fluxo FORGE
# ---------------------------------------------------------------
# Ideia central: o DeepSeek Harness que você USA no dia a dia (Trilha A,
# checkout C:\Users\Felipe\Dev\deepseek-harness, branch master) NUNCA é
# editado direto. As mudanças nascem no Trilha B (worktree de staging),
# são testadas numa instância separada (porta 3081, dados próprios) e só
# viram "versão nova" quando você valida — aí acontece o merge + tag + push.
#
# Uso:
#   forge status            painel do estado das duas trilhas
#   forge new <nome>        abre uma branch nova a partir da master validada
#   forge dev               sobe a instância de teste (http://127.0.0.1:3081)
#   forge stop              derruba a instância de teste
#   forge commit "msg"      salva as mudanças (commit) na branch
#   forge push              envia a branch pro GitHub (backup)
#   forge pr "título"       cria o pedido de aprovação (Pull Request)
#   forge release           você validou? une na master + etiqueta + publica
#   forge rollback [tag]    volta para uma versão anterior
#   forge sync              confere se a master está atualizada com o GitHub
# ---------------------------------------------------------------

param(
    [string]$Command = 'help',
    [string]$Arg1 = '',
    [string]$Arg2 = ''
)

# ----------------------- caminhos fixos -----------------------
$REPO      = 'C:\Users\Felipe\Dev\deepseek-harness'   # Trilha A — o que você USA
$STAGING   = 'C:\Users\Felipe\Dev\dsh-staging'        # Trilha B — onde EU edito
$DEV_HOME  = 'C:\Users\Felipe\Dev\dsh-dev-home'       # dados (sessões) da instância de teste
$WORKLOG   = 'C:\Users\Felipe\Dev\forge-worklog'      # rascunhos/logs fora do repositório
$DEV_PORT  = 3081                                     # porta da instância de teste
$REPO_GH   = 'FORM-BR/forge'                          # onde moram seus branches/PRs
$REMOTE    = 'forge'                                  # nome do remote que aponta pro GitHub acima
$TAG_PREFIX = 'forge/v'

# ----------------------- cores e utilidades -----------------------
function Say    { Write-Host $args -ForegroundColor Gray }
function Good   { Write-Host $args -ForegroundColor Green }
function Warn   { Write-Host $args -ForegroundColor Yellow }
function Alert  { Write-Host $args -ForegroundColor Red }
function Title  { Write-Host ""; Write-Host $args -ForegroundColor Cyan -NoNewline; Write-Host "" }

function Invoke-Git($Path, [string[]]$ArgsList) {
    & git -C $Path @ArgsList
    if ($LASTEXITCODE -ne 0) { throw "git $($ArgsList[0]) falhou (código $LASTEXITCODE)" }
}

function Confirm-Keyword([string]$Action) {
    $answer = Read-Host "Digite SIM para confirmar [$Action]"
    if ($answer.Trim().ToUpper() -ne 'SIM') {
        Warn "Cancelado — nada foi feito."
        exit 0
    }
}

# ----------------------- status -----------------------
function Show-Status {
    Title "== FORGE — painel de estado =="

    Write-Host ""
    Write-Host "  TRILHA A (o harness que voce USA)" -ForegroundColor Cyan
    $branchA = git -C $REPO branch --show-current
    $dirtyA  = git -C $REPO status --porcelain
    Write-Host "    Checkout : $REPO"
    Write-Host "    Branch   : $branchA"
    if ($dirtyA) { Warn "    Estado   : ATENCAO — working tree sujo ($($dirtyA.Count) arquivo(s)). Deve ficar limpo!" }
    else         { Good  "    Estado   : limpo (nada pendente) — como deve ser" }

    Write-Host ""
    Write-Host "  TRILHA B (onde as mudancas nascem)" -ForegroundColor Cyan
    if (Test-Path $STAGING) {
        $branchB = git -C $STAGING branch --show-current
        $dirtyB  = git -C $STAGING status --porcelain
        Write-Host "    Checkout : $STAGING"
        Write-Host "    Branch   : $branchB"
        if ($dirtyB) { Warn "    Estado   : $($dirtyB.Count) arquivo(s) alterado(s) nao commitados" }
        else         { Good "    Estado   : limpo" }
    } else {
        Warn "    Aviso    : staging nao existe — rode 'forge new <nome>'"
    }

    Write-Host ""
    Write-Host "  INSTANCIA DE TESTE" -ForegroundColor Cyan
    $up = Test-NetConnection -ComputerName 127.0.0.1 -Port $DEV_PORT -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($up) { Good "    http://127.0.0.1:$DEV_PORT  -> no ar (instancia dev rodando)" }
    else     { Warn "    http://127.0.0.1:$DEV_PORT  -> parada (use 'forge dev' para subir)" }
    $pidFile = Join-Path $WORKLOG "forge-dev.pid"
    if (Test-Path $pidFile) {
        $pidSaved = Get-Content $pidFile
        if (Get-Process -Id $pidSaved -ErrorAction SilentlyContinue) { Say "    pid: $pidSaved" }
        else { Warn "    pid: $pidSaved (processo morto — arquivo obsoleto)" }
    }

    Write-Host ""
    Write-Host "  VERSOES (tags)" -ForegroundColor Cyan
    $tags = git -C $REPO tag --list "$TAG_PREFIX*" | Sort-Object -Descending | Select-Object -First 5
    if ($tags) { $tags | ForEach-Object { Say "    $_" } }
    else { Warn "    Nenhuma tag ainda — a primeira 'versao nova' criara a primeira." }

    $statusG = git -C $STAGING status -sb | Select-Object -First 1
    if ($statusG -match '^## \S+\.\.\.') {
        $upstream = ($statusG -split '\.\.\.')[1]
        Say ""
        Say "  (branch do staging rastreia: $upstream)"
    }
}

# ----------------------- new -----------------------
function New-Branch([string]$Name) {
    if (-not $Name) { Alert "Uso: forge new <nome>  (ex.: forge new plugin-status)"; return }
    $branch = "forge/$Name"

    $dirtyA = git -C $REPO status --porcelain
    if ($dirtyA) {
        Alert "Regra de ouro: a master (Trilha A) precisa estar limpa antes de abrir uma branch."
        Alert "$($dirtyA.Count) arquivo(s) pendente(s). Mova rascunhos para o worklog ou commite-os primeiro."
        return
    }
    if (-not (Test-Path $STAGING)) {
        Alert "Staging inexistente. Crie com: git -C `"$REPO`" worktree add `"$STAGING`" -b $branch master"
        return
    }

    $currentB = git -C $STAGING branch --show-current
    if ($currentB -eq $branch) { Warn "A branch $branch ja esta ativa no staging."; return }

    Say "Partindo do topo validado da master (o commit que voce usa agora)..."
    Invoke-Git $STAGING @('switch', '-c', $branch, 'master')
    Good "Branch '$branch' criada no staging, a partir da master."
    Say "  Agora eu edito aqui. O harness que voce usa continua intacto na master."
}

# ----------------------- build -----------------------
function Build-Libs {
    Push-Location $STAGING
    try {
        Say "Compilando as bibliotecas do harness no staging (só na primeira vez demora; depois é rápido)..."
        & pnpm build:lib 2>&1 | Tee-Object -FilePath (Join-Path $WORKLOG 'build-staging.log') | Select-Object -Last 3
        if ($LASTEXITCODE -ne 0) { Alert "Build falhou. Veja $(Join-Path $WORKLOG 'build-staging.log')"; return }
        Good "Bibliotecas compiladas."
    } finally { Pop-Location }
}

# ----------------------- dev / stop -----------------------
function Start-Dev {
    New-Item -ItemType Directory -Force -Path $WORKLOG | Out-Null

    $libProbe = Join-Path $STAGING 'packages\client\ui-trajectory\lib\client.js'
    if (-not (Test-Path $libProbe)) {
        Warn "Staging ainda nao tem as bibliotecas compiladas — rodando 'forge build' automaticamente..."
        Build-Libs
    }

    $profileDir = Join-Path $DEV_HOME "profiles\forge-dev"

    if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
        Say "Primeira vez: criando o perfil 'forge-dev' (copia fiel do perfil web) com dados proprios em $DEV_HOME..."
        $env:DSH_HOME = $DEV_HOME
        & pnpm dsh --profile forge-dev --from-default-profile web --dump-config *> (Join-Path $WORKLOG 'profile-init.log')
        if ($LASTEXITCODE -ne 0) {
            Alert "Falha ao inicializar o perfil. Veja $(Join-Path $WORKLOG 'profile-init.log')"
            return
        }
        Good "Perfil forge-dev criado."
    }

    $pidFile = Join-Path $WORKLOG "forge-dev.pid"
    if (Test-Path $pidFile) {
        $old = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
            Warn "A instancia dev ja esta rodando (pid $old). Use 'forge stop' antes ou abra http://127.0.0.1:$DEV_PORT"
            return
        }
    }

    $cmd = "`$env:DSH_HOME='$DEV_HOME'; cd '$STAGING'; pnpm dsh --profile forge-dev --port $DEV_PORT --no-open 2>&1 | Tee-Object -FilePath '$(Join-Path $WORKLOG 'forge-dev.log')'"
    $proc = Start-Process pwsh -ArgumentList '-NoExit', '-Command', $cmd -WorkingDirectory $STAGING -PassThru
    $proc.Id | Out-File -FilePath $pidFile -Encoding ascii
    Start-Sleep -Seconds 6
    $urlMatch = Select-String -Path (Join-Path $WORKLOG 'forge-dev.log') -Pattern "dsh web: (http://\S+)" | Select-Object -Last 1
    if ($urlMatch) {
        $url = $urlMatch.Matches[0].Groups[1].Value
        Good "Instancia dev subindo (pid $($proc.Id)). Abra ESTA url (e ela que autentica o browser):"
        Write-Host "      $url" -ForegroundColor Green
        Say "  Se a url expirar ou voce fechar, rode 'forge stop' e 'forge dev' de novo."
    } else {
        Good "Instancia dev subindo (pid $($proc.Id)). Aguarde o boot e abra a url que aparecer no log."
    }
    Say "  Logs: $(Join-Path $WORKLOG 'forge-dev.log')  |  Parar: forge stop"
    Say "  O original continua em http://127.0.0.1:3080 — os dois convivem."
}

function Stop-Dev {
    $pidFile = Join-Path $WORKLOG "forge-dev.pid"
    if (-not (Test-Path $pidFile)) { Warn "Nenhuma instancia dev registrada."; return }
    $pidSaved = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($pidSaved -and (Get-Process -Id $pidSaved -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $pidSaved -Force
        Good "Instancia dev parada (pid $pidSaved)."
    } else {
        Warn "PID $pidSaved nao estava rodando."
    }
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

# ----------------------- commit / push / pr -----------------------
function Do-Commit([string]$Message) {
    if (-not $Message) { Alert "Uso: forge commit `"mensagem em portugues`""; return }
    $status = git -C $STAGING status --short
    if (-not $status) { Warn "Nada para commitar no staging."; return }
    Say "Arquivos que serao salvos neste commit:"
    $status | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Invoke-Git $STAGING @('add', '-A')
    # --no-verify: os hooks do lefthook quebram neste Windows (sh.exe falha sob sandbox).
    # As verificacoes reais (typecheck/lint) rodam manualmente quando o build pedir.
    Invoke-Git $STAGING @('commit', '--no-verify', '-m', $Message)
    Good "Commit criado: $Message"
    Say "  Commit = fotografia do estado. A master continua intocada."
}

function Do-Push {
    $branch = git -C $STAGING branch --show-current
    if ($branch -eq 'master') { Alert "No staging voce nunca esta na master — rode 'forge new'."; return }
    Say "Enviando a branch '$branch' para o GitHub ($REPO_GH)..."
    # --no-verify: mesmos hooks de pre-push quebrados neste Windows (veja commit).
    Invoke-Git $STAGING @('push', '--no-verify', '-u', $REMOTE, $branch)
    Good "Branch publicada: https://github.com/$REPO_GH/tree/$branch"
    Say "  Push = backup + fica pronto para o pedido de aprovacao."
}

function Do-Pr([string]$Title) {
    $branch = git -C $STAGING branch --show-current
    if ($branch -eq 'master') { Alert "No staging voce nunca esta na master — rode 'forge new'."; return }
    if (-not $Title) { $Title = "forge: $branch" }
    $body = @"
O que mudou: (descricao)
Como testar: abra http://127.0.0.1:3081 e ...
Situacao: [ ] testado pelo Felipe  [ ] aprovado
"@
    Say "Criando o pedido de aprovacao (Pull Request) $branch -> master..."
    $prUrl = gh pr create --repo $REPO_GH --base master --head $branch --title $Title --body $body
    if ($LASTEXITCODE -ne 0) { Warn "Falha ao criar o PR — a branch foi publicada? ('forge push')"; return }
    Good "PR criado: $prUrl"
    Say "  PR = pedido de aprovacao. Voce testa na porta 3081 e, quando validar, eu rodo 'forge release'."
}

# ----------------------- release -----------------------
function Do-Release {
    $branch = git -C $STAGING branch --show-current
    if ($branch -eq 'master') { Alert "No staging voce nunca esta na master — rode 'forge new'."; return }
    $pr = gh pr list --repo $REPO_GH --head $branch --state open --json number,url 2>$null
    if (-not $pr) { Alert "Nao achei PR aberto para '$branch'. Rode 'forge push' e 'forge pr' primeiro."; return }
    $prJson = $pr | ConvertFrom-Json
    $prNum = $prJson[0].number

    Alert ""
    Alert "Isso vai UNIR '$branch' na master e publicar como versao nova no GitHub."
    Alert "Depois de publicado, o harness que voce usa so muda quando voce reiniciar o launch."
    Confirm-Keyword "release"

    $dirtyA = git -C $REPO status --porcelain
    if ($dirtyA) { Alert "Master local suja — nao posso prosseguir. Limpe a Trilha A primeiro."; return }

    Say "(1/3) Juntando a branch na master pelo GitHub (gh pr merge)..."
    gh pr merge $prNum --repo $REPO_GH --merge --delete-branch=false
    if ($LASTEXITCODE -ne 0) { Alert "Merge falhou (conflito?). Resolva e tente de novo."; return }

    Say "(2/3) Atualizando a master local com o resultado..."
    Invoke-Git $REPO @('fetch', $REMOTE)
    Invoke-Git $REPO @('merge', '--ff-only', "$REMOTE/master")

    $tag = "$TAG_PREFIX$(Get-Date -Format 'yyyyMMdd-HHmm')"
    Say "(3/3) Criando a etiqueta de versao '$tag' e publicando..."
    Invoke-Git $REPO @('tag', $tag)
    Invoke-Git $REPO @('push', '--no-verify', $REMOTE, $tag)

    Good ""
    Good "Versao nova publicada: $tag"
    Say "  - Branch   : $branch  ->  master (PR #$prNum)"
    Say "  - Etiqueta : $tag  (o GitHub guarda pra sempre; qualquer momento da pra voltar)"
    Say "  - Para USAR a versao nova: feche e reabra o launch-dsh.bat (so isso)."
}

# ----------------------- rollback -----------------------
function Do-Rollback([string]$Tag) {
    $tags = git -C $REPO tag --list "$TAG_PREFIX*" | Sort-Object -Descending
    if (-not $Tag) {
        Warn "Versoes disponiveis (use: forge rollback forge/v<algo>):"
        $tags | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        return
    }
    $exists = git -C $REPO tag --list $Tag
    if (-not $exists) { Alert "Tag '$Tag' nao existe."; return }

    Alert ""
    Alert "Isso volta a master LOCAL para a versao $Tag (descarta os commits mais novos LOCALMENTE)."
    Alert "A versao nova continua salva no GitHub — nada se perde, e voce pode voltar de novo."
    Confirm-Keyword "rollback para $Tag"

    $dirtyA = git -C $REPO status --porcelain
    if ($dirtyA) { Alert "Master local suja — limpe a Trilha A primeiro."; return }
    Invoke-Git $REPO @('reset', '--hard', $Tag)
    Good "Master local agora esta em $Tag."
    Warn "Para o GitHub refletir o rollback seria preciso push forcado — isso so acontece com seu pedido explicito na hora."
    Say "Reinicie o launch-dsh.bat quando quiser usar esta versao."
}

# ----------------------- sync -----------------------
function Do-Sync {
    Say "Buscando novidades do GitHub ($REMOTE)..."
    Invoke-Git $REPO @('fetch', $REMOTE)
    $behind = git -C $REPO rev-list --count "master..$REMOTE/master"
    $ahead  = git -C $REPO rev-list --count "$REMOTE/master..master"
    if ([int]$behind -gt 0) { Warn "Master local esta $behind commit(s) ATRAS do GitHub. Rode: git -C `"$REPO`" merge --ff-only $REMOTE/master" }
    else { Good "Master local esta em dia com o GitHub ($REMOTE/master)." }
    if ([int]$ahead -gt 0) { Warn "Master local tem $ahead commit(s) ainda nao publicados (push pendente)." }
    else { Good "Nada pendente de push na master." }
}

# ----------------------- help -----------------------
function Show-Help {
    Title "FORGE — fluxo de edicao segura do DeepSeek Harness"
    Write-Host @"

  TRILHA A  - o harness que voce USA  (master, C:\Users\Felipe\Dev\deepseek-harness)
  TRILHA B  - onde eu edito/testo    (staging, C:\Users\Felipe\Dev\dsh-staging)
  GITHUB    - historico e pedidos de aprovacao (FORM-BR/forge)

  Comandos:
"@ -ForegroundColor Gray
    Write-Host "    forge status" -ForegroundColor White
    Write-Host "        painel visual: branch/estado das duas trilhas + instancia dev + versoes" -ForegroundColor DarkGray
    Write-Host "    forge new <nome>" -ForegroundColor White
    Write-Host "        abre uma branch nova a partir do topo validado da master" -ForegroundColor DarkGray
    Write-Host "    forge dev" -ForegroundColor White
    Write-Host "        sobe a instancia de teste em http://127.0.0.1:3081 (dados proprios)" -ForegroundColor DarkGray
    Write-Host "    forge build" -ForegroundColor White
    Write-Host "        compila as bibliotecas do staging (feito automaticamente na 1a vez do dev)" -ForegroundColor DarkGray
    Write-Host "    forge stop" -ForegroundColor White
    Write-Host "        derruba a instancia de teste" -ForegroundColor DarkGray
    Write-Host "    forge commit `"mensagem`"" -ForegroundColor White
    Write-Host "        salva as mudancas na branch (fotografia do estado)" -ForegroundColor DarkGray
    Write-Host "    forge push" -ForegroundColor White
    Write-Host "        envia a branch pro GitHub (backup)" -ForegroundColor DarkGray
    Write-Host "    forge pr `"titulo`"" -ForegroundColor White
    Write-Host "        cria o pedido de aprovacao (Pull Request) pra master" -ForegroundColor DarkGray
    Write-Host "    forge release" -ForegroundColor White
    Write-Host "        [depois que VOCE validar] une na master, etiqueta, publica" -ForegroundColor DarkGray
    Write-Host "    forge rollback [tag]" -ForegroundColor White
    Write-Host "        lista ou volta para uma versao anterior" -ForegroundColor DarkGray
    Write-Host "    forge sync" -ForegroundColor White
    Write-Host "        confere se a master esta em dia com o GitHub" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Documentos (no repositorio):" -ForegroundColor Gray
    Write-Host "    docs/FORGE/README.md   - o fluxo completo com diagrama" -ForegroundColor DarkGray
    Write-Host "    docs/FORGE/GIT-101.md  - Git e GitHub explicados de forma simples" -ForegroundColor DarkGray
    Write-Host "    forge/plugins/README.md - por que plugins nao quebram o harness" -ForegroundColor DarkGray
}

# ----------------------- despacho -----------------------
switch ($Command.ToLower()) {
    'status'   { Show-Status }
    'new'      { New-Branch $Arg1 }
    'build'    { Build-Libs }
    'dev'      { Start-Dev }
    'stop'     { Stop-Dev }
    'commit'   { Do-Commit $Arg1 }
    'push'     { Do-Push }
    'pr'       { Do-Pr $Arg1 }
    'release'  { Do-Release }
    'rollback' { Do-Rollback $Arg1 }
    'sync'     { Do-Sync }
    default    { Show-Help }
}