@echo off
setlocal
cd /d "%~dp0"
set "QDII_NODE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined QDII_NODE set "QDII_NODE=%%I"
if not defined QDII_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "QDII_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined QDII_NODE (
  echo Node.js was not found. Please install Node.js 22 or newer.
  exit /b 1
)
"%QDII_NODE%" -e "if(Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  exit /b 1
)
"%QDII_NODE%" "%~dp0launch.mjs"
echo.
echo Service exited. Runtime logs are stored in PostgreSQL runtime_logs.
endlocal
