#!/usr/bin/env bash
# Lance l'application de rameur et ouvre la page dans le navigateur.
cd "$(dirname "$0")"
( sleep 2; xdg-open http://localhost:8765 >/dev/null 2>&1 ) &
exec python3 rameur.py "$@"
