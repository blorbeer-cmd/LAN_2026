@echo off
cd /d C:\Users\BOB\LAN_2026\server
call npm run build
start "RespawnHQ Server" cmd /k npm start
timeout /t 3
start "RespawnHQ Tunnel" cmd /k cloudflared tunnel run lan2026
