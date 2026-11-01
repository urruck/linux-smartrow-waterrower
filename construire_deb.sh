#!/usr/bin/env bash
# Construit le paquet Debian/Ubuntu du rameur : dist/rameur-smartrow_VERSION_all.deb
# Installation ensuite : sudo apt install ./dist/rameur-smartrow_VERSION_all.deb
set -euo pipefail
VERSION="${1:-0.1.0}"
ICI="$(cd "$(dirname "$0")" && pwd)"
SORTIE="$ICI/dist"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT
P="$TRAVAIL/rameur-smartrow"
A="$P/usr/share/rameur-smartrow"

# Programme (les données personnelles vont dans ~/.local/share/rameur-smartrow)
install -d "$A/exemples"
install -m 755 "$ICI"/{rameur_app.py,rameur.py,ecouter.py} "$A/"
install -m 644 "$ICI"/{chemins.py,jeu.py,smartrow_ble.py,page.html,illustrations.js} "$A/"
install -m 644 "$ICI"/{jeu.json,programmes.json,recettes.json} "$A/"
install -m 644 "$ICI"/exemples/* "$A/exemples/"

install -d "$P/usr/bin"
cat > "$P/usr/bin/rameur" <<'EOF'
#!/bin/sh
# Application du rameur (fenêtre). Options : --reseau, --navigateur
exec python3 /usr/share/rameur-smartrow/rameur_app.py "$@"
EOF
chmod 755 "$P/usr/bin/rameur"

install -d "$P/usr/share/applications" "$P/usr/share/icons/hicolor/scalable/apps"
install -m 644 "$ICI/rameur-smartrow.svg" "$P/usr/share/icons/hicolor/scalable/apps/rameur-smartrow.svg"
cat > "$P/usr/share/applications/io.github.urruck.Rameur.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Rameur
GenericName=Rameur WaterRower SmartRow
Comment=Séances en direct, séances guidées et aventure avec un WaterRower équipé d'un SmartRow
Exec=rameur
Icon=rameur-smartrow
Terminal=false
Categories=Sports;Utility;
Keywords=rameur;aviron;WaterRower;SmartRow;sport;fitness;
StartupWMClass=io.github.urruck.Rameur
EOF
chmod 644 "$P/usr/share/applications/io.github.urruck.Rameur.desktop"

D="$P/usr/share/doc/rameur-smartrow"
install -d "$D"
install -m 644 "$ICI/README.md" "$D/"
cat > "$D/copyright" <<'EOF'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: rameur-smartrow
Source: https://github.com/urruck/linux-smartrow-waterrower

Files: *
Copyright: Yvan Godreau
License: GPL-3+
 Voir /usr/share/common-licenses/GPL-3.
EOF
printf 'rameur-smartrow (%s) unstable; urgency=low\n\n  * Version %s.\n\n -- Yvan Godreau <yvan.godreau@centresocial-chemille.asso.fr>  %s\n' \
  "$VERSION" "$VERSION" "$(date -R)" | gzip -9n > "$D/changelog.gz"
chmod 644 "$D"/*

install -d "$P/DEBIAN"
cat > "$P/DEBIAN/control" <<EOF
Package: rameur-smartrow
Version: $VERSION
Section: misc
Priority: optional
Architecture: all
Depends: python3 (>= 3.10), python3-bleak, bluez, python3-gi, gir1.2-gtk-4.0, gir1.2-webkit-6.0
Recommends: speech-dispatcher
Installed-Size: $(du -sk "$P/usr" | cut -f1)
Maintainer: Yvan Godreau <yvan.godreau@centresocial-chemille.asso.fr>
Homepage: https://github.com/urruck/linux-smartrow-waterrower
Description: application de rameur pour WaterRower équipé d'un SmartRow
 Lit le capteur SmartRow en Bluetooth et affiche la séance en direct :
 temps, distance, allure, puissance, cadence et courbe de force.
 Séances guidées avec voix et métronome, historique, aventure (descente
 de la Loire, badges, quêtes) et suivi du poids. Les séances sont
 enregistrées dans ~/.local/share/rameur-smartrow.
EOF

install -d "$SORTIE"
dpkg-deb --root-owner-group --build "$P" "$SORTIE/rameur-smartrow_${VERSION}_all.deb"
