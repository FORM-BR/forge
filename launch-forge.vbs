' Abre o FORGE sem janela de console: o atalho aponta para este .vbs (wscript nao abre console)
' e ele chama o launch-forge.ps1 com a janela do PowerShell oculta (estilo 0). Argumento "safe" = modo seguro (-Safe).
Dim fso, sh, dir, extra
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "safe" Then extra = " -Safe"
End If
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\launch-forge.ps1"" web" & extra, 0, False
