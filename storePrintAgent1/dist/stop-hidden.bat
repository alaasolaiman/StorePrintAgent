@echo off
setlocal
taskkill /IM StorePrintAgent.exe /F >nul 2>&1
if %ERRORLEVEL%==0 (
  echo StorePrintAgent stopped.
) else (
  echo StorePrintAgent is not running.
)
