@echo off
chcp 65001 >nul
title Dropship Hub - May chu test
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Lan dau chay: dang cai thu vien, doi khoang 1 phut...
  call npm install --no-fund --no-audit
)
if not exist web\dist\index.html (
  echo Dang build web app lan dau...
  call npm run build:web
)
node tools\test-server\server.mjs
pause
