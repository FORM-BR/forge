@echo off
title FORGE (celular)
rem Liga ou desliga o acesso do FORGE pelo celular (Tailscale), sem reinstalar. Atalho: "FORGE (celular)".
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0forge-celular.ps1"
echo.
pause
