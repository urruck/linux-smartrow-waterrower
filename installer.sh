#!/usr/bin/env bash
# Installe la bibliothèque Bluetooth (bleak) dans le dossier lib/, sans sudo.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pip install --quiet --target lib bleak
echo "Prêt. Lancez : bash rameur.sh"
