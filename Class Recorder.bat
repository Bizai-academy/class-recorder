@echo off
rem Bam dup file nay de mo giao dien Class Recorder trong trinh duyet.
cd /d "%~dp0"
title Class Recorder
rem Ban dong goi co san Node trong thu muc runtime; ban ma nguon thi dung Node cai tren may.
set "NODE=node"
if exist "%~dp0runtime
ode.exe" set "NODE=%~dp0runtime
ode.exe"
if not exist "%~dp0runtime
ode.exe" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Chua cai Node.js. Tai tai https://nodejs.org roi chay lai file nay.
    pause
    exit /b 1
  )
  if not exist node_modules (
    echo Dang cai thu vien lan dau, vui long cho...
    call npm install --no-fund --no-audit
  )
)
"%NODE%" srccli.js ui
pause
