#!/usr/bin/env python3
"""Étape 1 : écoute le SmartRow, affiche les valeurs décodées et enregistre
tous les messages bruts dans sessions/ pour vérifier le décodage.

  python3 ecouter.py              cherche le SmartRow puis écoute (Ctrl+C pour arrêter)
  python3 ecouter.py --scan       liste seulement les appareils Bluetooth proches
"""
import asyncio
import datetime
import os
import signal
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, "lib"))
sys.path.insert(0, ICI)

from bleak import BleakScanner  # noqa: E402
from bleak.exc import BleakError  # noqa: E402
import smartrow_ble as sr  # noqa: E402


async def scanner():
    print("Recherche des appareils Bluetooth (15 s)...")
    for app, pub in (await BleakScanner.discover(timeout=15, return_adv=True)).values():
        print(f"  {app.address}  {pub.rssi:4d} dBm  {pub.local_name or app.name or '?'}  {pub.service_uuids}")


async def ecouter():
    print("Recherche du SmartRow (jusqu'à 2 min). Tirez sur la poignée pour le réveiller...")
    appareil = None
    for _ in range(12):
        appareil = await sr.trouver(duree=10.0)
        if appareil:
            break
    if appareil is None:
        print("SmartRow introuvable. Il est peut-être en veille, trop loin, ou connecté au téléphone.")
        return 1
    print(f"Trouvé : {appareil.name} ({appareil.address}). Connexion...")
    os.makedirs(os.path.join(ICI, "sessions"), exist_ok=True)
    chemin = os.path.join(ICI, "sessions", datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S") + ".log")
    journal = open(chemin, "w", encoding="utf-8")
    etat = {}

    def recu(horo, brut, t, valeurs):
        journal.write(f"{horo:.3f}\t{brut.hex(' ')}\t{brut!r}\n")
        journal.flush()
        if t:
            etat.update({k: v for k, v in valeurs.items() if v is not None})
            print(f"[{t}] {brut.decode('ascii', 'replace')!r:22} {valeurs}")
        else:
            print(f"[?] {brut!r}")

    arret = asyncio.Event()
    boucle = asyncio.get_running_loop()
    boucle.add_signal_handler(signal.SIGINT, arret.set)
    boucle.add_signal_handler(signal.SIGTERM, arret.set)
    try:
        await sr.SmartRow(appareil, recu).lancer(arret)
    except (TimeoutError, asyncio.TimeoutError, BleakError) as e:
        print(f"Erreur Bluetooth : {e}")
        print("La connexion n'a pas abouti. Fermez l'appli SmartRow (ou coupez le Bluetooth du téléphone),"
              " tirez sur la poignée pour réveiller le capteur, puis relancez.")
        return 1
    finally:
        journal.close()
    print(f"\nMessages bruts enregistrés dans {chemin}")
    print(f"Dernières valeurs : {etat}")
    return 0


if __name__ == "__main__":
    if "--scan" in sys.argv:
        asyncio.run(scanner())
    else:
        sys.exit(asyncio.run(ecouter()))
