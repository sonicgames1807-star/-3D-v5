@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "Mesh Scan Studio server" cmd /k py -3 -m http.server 8000 --bind 127.0.0.1
) else (
  start "Mesh Scan Studio server" cmd /k python -m http.server 8000 --bind 127.0.0.1
)
timeout /t 2 >nul
start "" http://localhost:8000
