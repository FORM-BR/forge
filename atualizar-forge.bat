@echo off
title Atualizar FORGE
rem Reconstroi o FORGE (pnpm install + builds) com a janela visivel e reabre. Use quando o balao disser que ha versao nova.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-forge.ps1" web -Atualizar
