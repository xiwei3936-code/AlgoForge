@echo off
rem ---------------------------------------------------------------
rem Hot100 trainer - first run entry point.
rem This file is copied to the package ROOT as a Chinese-named .cmd.
rem
rem MUST stay pure ASCII with CRLF line endings: cmd.exe parses by byte
rem offset, and LF + multi-byte UTF-8 makes it split commands into
rem garbage that SILENTLY never executes. All Chinese text lives in
rem launch\setup.ps1, which is UTF-8 with BOM.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
set "PS1=%~dp0launch\setup.ps1"
if not exist "%PS1%" (
  echo.
  echo   [ERROR] launch\setup.ps1 was not found next to this file.
  echo.
  echo   The .zip was probably not extracted completely, or antivirus
  echo   removed it. Please extract the WHOLE .zip again into an empty
  echo   folder, then double-click this file once more.
  echo.
  echo   Expected: "%PS1%"
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
  echo.
  echo   Setup did not finish. Read the message above.
  echo.
)
pause
endlocal
