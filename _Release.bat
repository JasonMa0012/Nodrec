@echo off
setlocal
cd /d "%~dp0apps\desktop"
node --use-env-proxy scripts\release.mjs
if errorlevel 1 (
  echo Release failed. See the error above.
  pause
  exit /b 1
)
pause
