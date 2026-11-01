#!/usr/bin/env bash
# Installation sans sudo, depuis ce dossier : bibliothèque Bluetooth (bleak)
# dans lib/, commande ~/.local/bin/rameur et raccourci « Rameur » dans le menu.
# (Autre possibilité : le paquet .deb, voir construire_deb.sh et le README.)
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
cd "$ICI"
python3 -c "import bleak" 2>/dev/null || python3 -m pip install --quiet --target lib bleak

mkdir -p ~/.local/bin ~/.local/share/applications ~/.local/share/icons/hicolor/scalable/apps
ln -sfn "$ICI/rameur_app.py" ~/.local/bin/rameur
install -m 644 "$ICI/rameur-smartrow.svg" ~/.local/share/icons/hicolor/scalable/apps/rameur-smartrow.svg
cat > ~/.local/share/applications/io.github.urruck.Rameur.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Rameur
GenericName=Rameur WaterRower SmartRow
Comment=Séances en direct, séances guidées et aventure avec un WaterRower équipé d'un SmartRow
Exec=python3 "$ICI/rameur_app.py"
Icon=rameur-smartrow
Terminal=false
Categories=Sports;Utility;
Keywords=rameur;aviron;WaterRower;SmartRow;sport;fitness;
StartupWMClass=io.github.urruck.Rameur
DESKTOP
echo "Prêt : menu « Rameur », ou commande « rameur »."
