@echo off
title Atualizar FORGE
rem Reconstroi o FORGE (pnpm install + builds) com a janela visivel e reabre. Use quando o balao disser que ha versao nova.
rem Num checkout git (.git presente), antes de reconstruir atualiza com git pull --ff-only; se o pull falhar, para SEM reconstruir.
rem Instalacao por zip (sem .git): so reconstroi; para ter codigo novo, extraia o zip novo por cima e rode este arquivo.
cd /d "%~dp0"

if exist ".git" (
  echo == Atualizando o checkout ^(git pull --ff-only^) ==
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo [ERRO] git pull falhou -- nada foi reconstruido.
    echo Rode "git status" no checkout para ver as mudancas locais e tente de novo.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-forge.ps1" web -Atualizar
