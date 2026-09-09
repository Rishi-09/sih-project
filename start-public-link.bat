@echo off
title Rotax 915 iS - Public Phone Access Tunnel
echo ======================================================================
echo  Generating secure, public HTTPS link for your Android phone...
echo ======================================================================
echo.
echo Look for the link ending in: .trycloudflare.com
echo Open that link on your phone from ANYWHERE (mobile data/WiFi).
echo.
echo Press Ctrl+C to close the tunnel.
echo ======================================================================
echo.
"%~dp0tools\cloudflared.exe" tunnel --url http://localhost:3000
pause
