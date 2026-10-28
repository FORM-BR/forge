@echo off
rem Duplo clique: instala e abre o FORGE (Node, pnpm, build, atalhos e, se houver, Tailscale).
rem Roda tudo sem janela de console: wscript.exe chama instalar-forge-oculto.vbs, que executa
rem o PowerShell oculto e grava o progresso em %LOCALAPPDATA%\FORGE\install.log. Baloes de
rem notificacao avisam quando termina (ou se der erro). wscript.exe ja vem em todo Windows,
rem nao precisa instalar nada a mais.
cd /d "%~dp0"
start "" wscript.exe "%~dp0instalar-forge-oculto.vbs"
