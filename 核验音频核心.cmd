@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0.tools\source-preview-electron\electron.exe" "%~dp0scripts\check-audio-core.mjs"
exit /b %ERRORLEVEL%
