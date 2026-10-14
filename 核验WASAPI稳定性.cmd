@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "RHINE_CHECK_NODE=%~dp0.tools\source-preview-electron\electron.exe"
set "RHINE_NATIVE_AUDIO=%~dp0.tools\source-preview-native-audio\rhine-audio-host.exe"
if not exist "%RHINE_CHECK_NODE%" goto missing
if not exist "%RHINE_NATIVE_AUDIO%" goto missing
set "ELECTRON_RUN_AS_NODE=1"
echo Default WASAPI endpoint only. All playback uses generated silence.
"%RHINE_CHECK_NODE%" "%~dp0scripts\check-wasapi-stability.mjs" --hardware --extended
if errorlevel 1 exit /b 1
"%RHINE_CHECK_NODE%" "%~dp0scripts\check-native-output.mjs"
if errorlevel 1 exit /b 1
"%RHINE_CHECK_NODE%" "%~dp0scripts\check-native-audio-adapter.mjs"
exit /b %ERRORLEVEL%
:missing
echo Source-preview runtime or native host is missing. Build the source preview first.
exit /b 1
