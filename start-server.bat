@echo off
cd /d "%~dp0"
echo Starting Set Tools at http://localhost:8765/crew-tracker.html
start http://localhost:8765/crew-tracker.html
python -m http.server 8765
pause
