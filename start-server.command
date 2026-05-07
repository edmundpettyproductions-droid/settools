#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Set Tools server at http://localhost:8765"
echo "Opening in browser..."
sleep 1 && open "http://localhost:8765/crew-tracker.html" &
python3 -m http.server 8765
