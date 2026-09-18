@echo off
title MCN System - localhost:3000
cd /d %~dp0
echo ============================================
echo  MCN system starting...
echo  URL: http://localhost:3000
echo  (MVP home: /   V1 admin: /admin/)
echo  Close this window to stop the server.
echo ============================================
start "" "http://localhost:3000"
node v1\server.js
pause
