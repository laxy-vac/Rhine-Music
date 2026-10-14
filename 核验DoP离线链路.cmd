@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "RHINE_DOP_NODE=%~dp0.tools\source-preview-electron\electron.exe"
if not exist "%RHINE_DOP_NODE%" exit /b 1
set "ELECTRON_RUN_AS_NODE=1"
set "RHINE_NATIVE_TEST_MODE=mock-only"
echo Offline synthetic DoP checks only. No audio device will be opened.
"%RHINE_DOP_NODE%" "%~dp0scripts\check-dop-transport.mjs"
if errorlevel 1 exit /b 1
"%RHINE_DOP_NODE%" "%~dp0scripts\check-dsd-routing.mjs"
if errorlevel 1 exit /b 1
"%RHINE_DOP_NODE%" "%~dp0scripts\check-native-output.mjs"
if errorlevel 1 exit /b 1
"%RHINE_DOP_NODE%" "%~dp0scripts\check-native-audio-adapter.mjs"
exit /b %ERRORLEVEL%
