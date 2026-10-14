@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "RHINE_BUILD_NODE=%~dp0.tools\source-preview-electron\electron.exe"
if not exist "%RHINE_BUILD_NODE%" goto missing
set "ELECTRON_RUN_AS_NODE=1"
"%RHINE_BUILD_NODE%" "%~dp0scripts\build-source-preview.mjs"
set "RHINE_BUILD_STATUS=%ERRORLEVEL%"
if "%RHINE_BUILD_STATUS%"=="0" exit /b 0
echo Source interface build failed. No dependencies were installed or downloaded.
pause
exit /b %RHINE_BUILD_STATUS%
:missing
echo The project-local source-preview runtime has not been prepared.
pause
exit /b 1
