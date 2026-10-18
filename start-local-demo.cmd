@echo off
setlocal

cd /d "%~dp0"
set "LOCAL_NPM=%CD%\.local-tools\node-v22.23.3-win-x64\npm.cmd"

if exist "%LOCAL_NPM%" (
  set "NPM_CMD=%LOCAL_NPM%"
) else (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js/npm is not available. Install Node.js LTS or restore .local-tools.
    exit /b 1
  )
  set "NPM_CMD=npm"
)

if not exist "node_modules" (
  call "%NPM_CMD%" ci
  if errorlevel 1 exit /b 1
)

echo Starting local demo at http://127.0.0.1:5173/
call "%NPM_CMD%" run dev -- --port 5173 --strictPort
