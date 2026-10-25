@echo off
setlocal

cd /d "%~dp0"
set "LOCAL_NPM=%CD%\.local-tools\node-v22.23.3-win-x64\npm.cmd"

if exist "%LOCAL_NPM%" (
  set "PATH=%CD%\.local-tools\node-v22.23.3-win-x64;%PATH%"
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

echo Starting Agent MVP copy at http://127.0.0.1:5174/
set "PROJECT_ROOT=%CD%"
set "PYTHONUTF8=1"
set "PYTHONDONTWRITEBYTECODE=1"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "NO_PROXY=localhost,127.0.0.1"
set "FRONTEND_ORIGINS=http://127.0.0.1:5174"
set "AGENT_ENGINE=v2"
set "SUPERMIND_JUPYTER_WORKDIR=mcp/tradingnote-agent-mvp-backtests"
set "US_BACKTEST_WORKER_URL=http://127.0.0.1:8002"
if exist "backend\.venv\Scripts\python.exe" (
  echo Starting Agent MVP API at http://127.0.0.1:8001/
  start "TradingNote Agent MVP API" /D "%PROJECT_ROOT%\backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001"
) else (
  echo Backend virtual environment not found. Start the API separately from backend.
)
call "%NPM_CMD%" run dev -- --port 5174 --strictPort
