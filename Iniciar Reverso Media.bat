@echo off
chcp 65001 >nul 2>&1
title Reverso Media Server

echo.
echo   Reverso Media Server
echo   ====================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo   [ERRO] Node.js nao encontrado.
  echo   Instale em: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0scripts"

echo   Instalando dependencias...
call npm install --no-audit --no-fund >nul 2>&1
if %errorlevel% neq 0 (
  echo   [AVISO] npm install retornou erro. Tentando continuar...
)

echo   Iniciando servidor...
echo.
node local-server.mjs

for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":7847"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo.
echo   Servidor encerrado.
pause
