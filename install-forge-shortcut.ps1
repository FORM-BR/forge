# (Re)cria os atalhos do FORGE apontando para os scripts desta pasta (sem console, abre rapido).
# Funciona em qualquer maquina: tudo e relativo a pasta onde este script esta. Atualiza todo FORGE.lnk que ja exista nas
# duas "areas de trabalho" (a redirecionada, ex.: OneDrive, e %USERPROFILE%\Desktop) e cria na redirecionada se ainda
# nao houver. Rode de novo, de dentro da pasta definitiva, se a pasta do FORGE mudar de lugar.
# O launch-dsh.bat segue na pasta como fallback (caminho lento: pnpm + tsx, janela visivel).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$icone = Join-Path $dir 'apps\desktop\resources\forge-logo.ico'
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
  $s.IconLocation = "$icone,0"
  $s.Description = 'FORGE (servidor em segundo plano + navegador)'
  $s.Save()
  "Atalho atualizado: $lnk -> $($s.TargetPath) $($s.Arguments)"
  if ($d -ne $real) { continue }
  # Atalho irmao em modo seguro (so plugins do FORGE; nenhum arquivo do profile e alterado).
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
  # Atalho irmao para reconstruir o FORGE (pnpm install + builds numa janela visivel).
  $lnkUpd = Join-Path $d 'Atualizar FORGE.lnk'
  $u = $sh.CreateShortcut($lnkUpd)
  $u.TargetPath = Join-Path $dir 'atualizar-forge.bat'
  $u.WorkingDirectory = $dir
  $u.IconLocation = $s.IconLocation
  $u.Description = 'Reconstroi o FORGE (pnpm install + builds) e reabre'
  $u.Save()
  "Atalho atualizado: $lnkUpd -> $($u.TargetPath)"
  # Atalhos de celular de versoes anteriores: o acesso pelo celular agora liga e desliga DENTRO do FORGE.
  foreach ($velho in 'FORGE (celular).lnk', 'FORGE (link do celular).lnk') {
    Remove-Item -LiteralPath (Join-Path $d $velho) -Force -ErrorAction SilentlyContinue
  }
}
