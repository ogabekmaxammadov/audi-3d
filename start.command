#!/bin/zsh
# Saytni lokal serverda ishga tushiradi va brauzerda ochadi.
cd "$(dirname "$0")"
PORT=5173
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server $PORT
