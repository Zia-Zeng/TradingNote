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
set "PROJECT_ROOT=%CD%"
if exist "backend\.venv\Scripts\python.exe" (
  echo Starting TradingNote API at http://127.0.0.1:8000/
  start "TradingNote API" cmd /k "cd /d %PROJECT_ROOT%\backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
) else (
  echo Backend virtual environment not found. Start the API separately from backend.
)
call "%NPM_CMD%" run dev -- --port 5173 --strictPort
