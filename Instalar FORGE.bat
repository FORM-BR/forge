@echo off
title Instalar FORGE
rem Duplo clique: instala e abre o FORGE (Node, pnpm, build, atalhos e, se houver, Tailscale).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-forge.ps1"
echo.
pause
