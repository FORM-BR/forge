' Abre o FORGE sem janela de console: o atalho aponta para este .vbs (wscript nao abre console)
' e ele chama o launch-forge.ps1 com a janela do PowerShell oculta (estilo 0).
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\launch-forge.ps1"" web", 0, False
