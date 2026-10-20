@echo off
if not exist "%~dp0QdiiHelp.exe" (
  echo QdiiHelp.exe is missing. Build it with tray\build.ps1 first.
  pause
  exit /b 1
)
start "" "%~dp0QdiiHelp.exe"
