@echo off
cd /d "%~dp0"
echo Starting Set Tools at http://localhost:8765/index.html
start http://localhost:8765/index.html
python -m http.server 8765
pause
