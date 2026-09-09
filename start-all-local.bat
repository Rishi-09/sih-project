@echo off
title Rotax 915 iS Twin - Local Stack Launcher
echo ======================================================================
echo  Starting Full Local Stack (Physics Engine + ML + Twin Server + Web UI)
echo ======================================================================

REM 1. Start Retribution Physics Simulator & Local ML Engine on Port 8766
echo [1/4] Starting Retribution Engine & ML Simulator (Port 8766)...
start "Retribution Engine Simulator" /D "%~dp0retribution" python run_ws_only.py

REM 2. Start Twin Backend Server on Port 4000
echo [2/4] Starting Twin Backend Server (Port 4000)...
start "Twin Server (:4000)" /D "%~dp0server" npm run dev

REM 3. Start Web Console on Port 3000
echo [3/4] Starting Next.js Web Console (Port 3000)...
start "Web Console (:3000)" /D "%~dp0web" npm run dev

REM 4. Start 24/7 PC Sentinel Alert Agent (Runs silently in background)
echo [4/4] Starting PC Sentinel Background Agent...
cd /d "%~dp0services\pc-agent"
cscript //nologo start-silent.vbs

echo ======================================================================
echo  All services started locally!
echo   - Web Console:    http://localhost:3000
echo   - Backend Server: http://localhost:4000
echo   - Simulator WS:   ws://localhost:8766
echo ======================================================================
pause
