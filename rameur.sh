#!/usr/bin/env bash
# Lance le rameur dans le navigateur (sans fenêtre d'application).
# Pour la fenêtre : python3 rameur_app.py, ou le menu « Rameur ».
cd "$(dirname "$0")"
( sleep 2; xdg-open http://localhost:8765 >/dev/null 2>&1 ) &
exec python3 rameur.py "$@"
