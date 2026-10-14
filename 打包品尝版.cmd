@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "RHINE_PACKAGE_NODE=%~dp0.tools\source-preview-electron\electron.exe"
if not exist "%RHINE_PACKAGE_NODE%" goto missing
set "ELECTRON_RUN_AS_NODE=1"
"%RHINE_PACKAGE_NODE%" "%~dp0scripts\package-preview.mjs" %*
set "RHINE_PACKAGE_STATUS=%ERRORLEVEL%"
if "%RHINE_PACKAGE_STATUS%"=="0" exit /b 0
echo Packaging failed. No software or dependencies were installed automatically.
pause
exit /b %RHINE_PACKAGE_STATUS%
:missing
echo Missing project-local Electron runtime. Nothing was installed or downloaded.
pause
exit /b 1
