#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Set Tools server at http://localhost:8282"
echo "Opening in browser..."
sleep 1 && open "http://localhost:8282/index.html" &
python3 -m http.server 8282 --bind 127.0.0.1
