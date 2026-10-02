# (Re)cria o atalho FORGE apontando para o launch-forge.vbs desta pasta (sem console, abre rapido).
# Atualiza todo FORGE.lnk existente nas duas "areas de trabalho" desta maquina (a redirecionada para o OneDrive e
# C:\Users\Felipe\Desktop) e cria na redirecionada se ainda nao houver. Rode de novo, de dentro da pasta definitiva,
# se o repo/worktree mudar de lugar. O launch-dsh.bat segue no repo como fallback (caminho lento: pnpm + tsx, janela visivel).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sh = New-Object -ComObject WScript.Shell
$real = [Environment]::GetFolderPath('Desktop')
$alvos = @($real, (Join-Path $env:USERPROFILE 'Desktop')) | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ }
foreach ($d in $alvos) {
  $lnk = Join-Path $d 'FORGE.lnk'
  if (-not (Test-Path -LiteralPath $lnk) -and $d -ne $real) { continue }
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $s.Arguments = '"' + (Join-Path $dir 'launch-forge.vbs') + '"'
  $s.WorkingDirectory = $env:USERPROFILE          # nunca a raiz do repo (rotulo Low do sandbox)
  $s.WindowStyle = 7
  $s.IconLocation = 'C:\Users\Felipe\Dev\deepseek-harness\apps\desktop\resources\forge-logo.ico,0'
  $s.Description = 'FORGE (servidor em segundo plano + navegador)'
  $s.Save()
  "Atalho atualizado: $lnk -> $($s.TargetPath) $($s.Arguments)"
  # Atalho irmao em modo seguro (so plugins do FORGE; nenhum arquivo do profile e alterado). Criado so na area de trabalho real.
  if ($d -eq $real) {
    $lnkSafe = Join-Path $d 'FORGE (modo seguro).lnk'
    $t = $sh.CreateShortcut($lnkSafe)
    $t.TargetPath = $s.TargetPath
    $t.Arguments = $s.Arguments + ' safe'
    $t.WorkingDirectory = $s.WorkingDirectory
    $t.WindowStyle = 7
    $t.IconLocation = $s.IconLocation
    $t.Description = 'FORGE em modo seguro (sem plugins de terceiros nem MCP)'
    $t.Save()
    "Atalho atualizado: $lnkSafe -> $($t.TargetPath) $($t.Arguments)"
  }
}
