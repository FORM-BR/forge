' Instalar-FORGE-oculto.vbs
' Roda instalar-forge.ps1 sem nenhuma janela de console visivel. Chamado por
' "Instalar FORGE.bat" via wscript.exe (disponivel em todo Windows 10/11 sem
' instalar nada). Toda a saida do PowerShell (Write-Host incluso) vai para
' %LOCALAPPDATA%\FORGE\install.log; baloes de notificacao mostram inicio, fim
' e erro, sem precisar olhar nenhuma janela de terminal.
Option Explicit

Dim fso, shell, scriptDir, logDir, logFile, psArgs, exitCode
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

logDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\FORGE"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\install.log"

' Chama powershell.exe direto (sem passar por cmd.exe, que exigiria aninhar aspas duplas duas
' vezes). *>&1 dentro do -Command junta stdout e stderr antes do redirecionamento, assim erros
' de winget/npm tambem ficam gravados no log, nao soltos num console que nao existe.
psArgs = "-NoProfile -ExecutionPolicy Bypass -Command ""& '" & scriptDir & "\instalar-forge.ps1' *>&1 | Out-File -FilePath '" & logFile & "' -Encoding utf8"""

' 0 = janela totalmente oculta; True = espera terminar antes de seguir (para o balao final saber o resultado).
exitCode = shell.Run("powershell.exe " & psArgs, 0, True)

If exitCode = 0 Then
  ShowBalloon "FORGE instalado", "Abra pelo atalho criado na area de trabalho."
Else
  ShowBalloon "Falha ao instalar o FORGE", "Veja o log em " & logFile & " (codigo " & exitCode & ")."
End If

Sub ShowBalloon(title, text)
  ' Reaproveita o mesmo truque de balao (NotifyIcon) usado por launch-forge.ps1 Show-Toast,
  ' num PowerShell oculto independente que se fecha sozinho depois de mostrar o balao.
  Dim ico, code
  ico = scriptDir & "\apps\desktop\resources\forge-logo.ico"
  code = "Add-Type -AssemblyName System.Windows.Forms, System.Drawing; " & _
    "$n = New-Object System.Windows.Forms.NotifyIcon; " & _
    "$n.Icon = if (Test-Path '" & ico & "') { New-Object System.Drawing.Icon('" & ico & "') } else { [System.Drawing.SystemIcons]::Information }; " & _
    "$n.Visible = $true; " & _
    "$n.ShowBalloonTip(15000, '" & Replace(title, "'", "''") & "', '" & Replace(text, "'", "''") & "', 'Info'); " & _
    "Start-Sleep 15; $n.Dispose()"
  shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -Command """ & code & """", 0, False
End Sub