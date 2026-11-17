@echo off
rem ---------------------------------------------------------------
rem Hot100 trainer - one-click UI update.
rem Copied to the package ROOT as a Chinese-named .cmd.
rem
rem Accepts an optional dragged-on .zip as %1; with no argument the
rem PowerShell script looks for the update package by itself.
rem
rem MUST stay pure ASCII with CRLF line endings, and every %VAR% that
rem sits inside a parenthesised block MUST be quoted: cmd.exe parses
rem such a block as a whole and substitutes %VAR% at parse time, so a
rem ")" anywhere in the path closes the block early and the WHOLE file
rem dies with "was unexpected at this time" - no message, no pause.
rem Paths like "Hot100 ... (1)\" are exactly what a second download
rem produces, so this is not hypothetical.
rem All Chinese text lives in launch\update.ps1 (UTF-8 with BOM).
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
set "PS1=%~dp0launch\update.ps1"
if not exist "%PS1%" (
  echo.
  echo   [ERROR] launch\update.ps1 was not found next to this file.
  echo.
  echo   The .zip was probably not extracted completely, or antivirus
  echo   removed it. Please extract the WHOLE program .zip again.
  echo.
  echo   Expected: "%PS1%"
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" "%~1"
pause
endlocal
