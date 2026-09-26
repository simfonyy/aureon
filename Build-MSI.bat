@echo off
setlocal
cd /d "%~dp0"
title Aureon - Build MSI 1.0.0
echo Aureon 1.0.0 - MSI build
echo This can take several minutes. Internet is needed for the first build.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-MSI.ps1"
if errorlevel 1 (
    echo.
    echo BUILD FAILED. See the message above and the build-logs folder.
    pause
    exit /b 1
)
echo.
echo DONE. The MSI folder is open.
pause
exit /b 0