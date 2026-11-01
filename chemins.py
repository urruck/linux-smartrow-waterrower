"""Emplacement des données personnelles (séances, profil, pesées).

Le programme peut être installé dans un dossier en lecture seule
(/usr/share/rameur-smartrow avec le paquet .deb) : les données vont donc dans
~/.local/share/rameur-smartrow/ (ou dans $RAMEUR_DONNEES si défini).

Au premier lancement, les séances et le profil d'une ancienne installation
(dossiers sessions/ et donnees/ à côté du programme) y sont copiés ; les
originaux restent en place comme sauvegarde.
"""
import os
import shutil

ICI = os.path.dirname(os.path.abspath(__file__))
_XDG = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
BASE = os.environ.get("RAMEUR_DONNEES") or os.path.join(_XDG, "rameur-smartrow")
SESSIONS = os.path.join(BASE, "sessions")
DONNEES = os.path.join(BASE, "donnees")


def preparer():
    """Crée les dossiers et reprend les données d'une ancienne installation."""
    for nom, cible in (("sessions", SESSIONS), ("donnees", DONNEES)):
        ancien = os.path.join(ICI, nom)
        if os.path.isdir(ancien) and not os.path.exists(cible) and os.listdir(ancien):
            shutil.copytree(ancien, cible)
            print(f"Données reprises : {ancien} -> {cible}")
        os.makedirs(cible, exist_ok=True)


preparer()
