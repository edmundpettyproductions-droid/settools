@echo off
cd /d "%~dp0"
echo Starting Set Tools at http://localhost:8282/index.html
start http://localhost:8282/index.html
python -m http.server 8282 --bind 127.0.0.1
pause
