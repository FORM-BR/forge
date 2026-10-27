@echo off
title FORGE
rem FALLBACK (lento: pnpm + tsx, janela visivel). O atalho normal usa launch-forge.vbs -> launch-forge.ps1 (build compilado, escondido).
cd /d "%~dp0"
call pnpm dsh web
pause
