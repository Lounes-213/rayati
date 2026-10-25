@echo off
title Rayti Studio Pro - Local Desktop Launcher
echo ========================================================
echo   RAYTI STUDIO PRO - STADIUM LIGHTING CONTROL SOFTWARE
echo   Launching standalone desktop application on your PC...
echo ========================================================

REM Start local Vite server in the background if not active
start /b cmd /c "npx vite --port 5173"

REM Wait 2 seconds for local server to bind
timeout /t 2 /nobreak >nul

REM Launch Microsoft Edge or Google Chrome in Standalone Desktop Application Window Mode
where msedge >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo Launching in Microsoft Edge Desktop Mode...
  start "" msedge --app=http://localhost:5173/control.html --window-size=1400,900
  goto END
)

where chrome >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo Launching in Google Chrome Desktop Mode...
  start "" chrome --app=http://localhost:5173/control.html --window-size=1400,900
  goto END
)

REM Fallback: default browser
echo Opening in default browser...
start http://localhost:5173/control.html

:END
echo Rayti Studio Pro is now running locally on your PC.
