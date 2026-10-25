@echo off
setlocal
cd /d "%~dp0"
set "PATH=%CD%\.local-tools\node-v22.23.3-win-x64;%PATH%"
call npm run build
if errorlevel 1 (
  echo Demo build failed.
  pause
  exit /b 1
)
call npm run preview -- --port 5174 --strictPort
