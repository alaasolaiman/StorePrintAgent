@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '.\StorePrintAgent.exe' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo StorePrintAgent started in background (hidden window).
echo Logs: %~dp0logs\agent.log
