@echo off
chcp 65001 >nul
setlocal
set "PS1=%~dp0start-hot100.ps1"
if not exist "%PS1%" (
  echo.
  echo   [ERROR] start-hot100.ps1 not found next to this file.
  echo   It may have been removed by antivirus, or the launch folder was moved.
  echo   Path: "%PS1%"
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
  echo.
  echo   Launcher exited with an error. See log:
  echo   "%LOCALAPPDATA%\Hot100Trainer\launcher.log"
  echo.
  pause
)
endlocal
