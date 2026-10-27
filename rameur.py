#!/usr/bin/env python3
"""Application de rameur pour WaterRower + SmartRow.

Lit le SmartRow en Bluetooth et affiche la séance en direct dans le
navigateur : temps, distance, allure, watts, cadence, courbe de force.
Chaque séance est enregistrée dans sessions/ (format JSON).

  python3 rameur.py              puis ouvrir http://localhost:8765
  python3 rameur.py --reseau     page visible aussi depuis une tablette ou un
                                 téléphone du même réseau Wi-Fi
  python3 rameur.py --rejouer exemples/seance-260m.log [--vitesse 4]
                                 rejoue une écoute enregistrée (démo, essais)
"""
import ast
import asyncio
import datetime
import json
import os
import signal
import sys
import time
import urllib.parse

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, "lib"))
sys.path.insert(0, ICI)

from bleak.exc import BleakError  # noqa: E402
import jeu  # noqa: E402
import smartrow_ble as sr  # noqa: E402

PORT = 8765
DOSSIER = os.path.join(ICI, "sessions")
CHAMPS = ("distance_m", "temps_s", "watts", "watts_moyens", "cadence", "coups",
          "allure_500m_s", "allure_moyenne_s", "travail_j", "longueur_coup", "arret")


class Seance:
    """État en direct et enregistrement de la séance en cours."""

    def __init__(self):
        self.etat = {"connexion": "recherche"}
        self.abonnes = set()
        self._courbe = []
        self.nouvelle()

    def nouvelle(self):
        self.debut = datetime.datetime.now()
        self.programme = None  # nom de la séance guidée suivie
        self.termine = False   # séance guidée menée jusqu'au bout
        self.precision = None  # % du temps passé dans la cadence cible
        self.points = []      # un relevé par seconde
        self.coups = []       # une courbe de force par coup
        self._derniere_sec = 0
        self._modifiee = False
        for k in CHAMPS:
            self.etat.pop(k, None)
        self.etat["courbe"] = []
        self.diffuser()

    @property
    def fichier(self):
        return os.path.join(DOSSIER, self.debut.strftime("%Y-%m-%d_%H%M%S") + ".json")

    def recu(self, horo, brut, t, valeurs):
        if not t:
            return
        if t in "xyz":
            if t == "x":
                self._courbe = []
            self._courbe += valeurs["courbe"]
            if t == "z":
                courbe = self._courbe
                while courbe and courbe[-1] == 0:  # retire les zéros de fin
                    courbe = courbe[:-1]
                if courbe:
                    self.etat["courbe"] = courbe
                    self.coups.append({"t": round(horo, 1), "courbe": courbe})
                    self._modifiee = True
                self.diffuser()
            return
        dist = valeurs.get("distance_m")
        if dist is not None and dist < self.etat.get("distance_m", 0) - 5:
            self.sauver()       # le compteur est revenu à zéro : nouvelle séance
            self.nouvelle()
        self.etat.update({k: v for k, v in valeurs.items() if v is not None and k in CHAMPS})
        if self.etat.get("distance_m", 0) > 0 and int(horo) != self._derniere_sec and not self.etat.get("arret"):
            self._derniere_sec = int(horo)
            self.points.append({"t": int(horo), **{k: self.etat.get(k) for k in CHAMPS if k != "arret"}})
            self._modifiee = True
        if t == "a":            # environ 2 fois par seconde : assez pour l'affichage
            self.diffuser()

    def diffuser(self):
        msg = ("data: " + json.dumps(self.etat) + "\n\n").encode()
        for w in list(self.abonnes):
            try:
                w.write(msg)
            except (ConnectionError, RuntimeError):
                self.abonnes.discard(w)

    def resume(self):
        e = self.etat
        return {k: e.get(k) for k in ("distance_m", "temps_s", "watts_moyens", "allure_moyenne_s", "coups")}

    def sauver(self):
        if not self._modifiee or self.etat.get("distance_m", 0) < 10:
            return
        os.makedirs(DOSSIER, exist_ok=True)
        with open(self.fichier, "w", encoding="utf-8") as f:
            json.dump({"debut": self.debut.isoformat(timespec="seconds"), "programme": self.programme,
                       "termine": self.termine, "precision_cadence": self.precision,
                       "resume": self.resume(),
                       "points": self.points, "coups": self.coups}, f)
        self._modifiee = False


def historique():
    res = []
    if os.path.isdir(DOSSIER):
        for nom in sorted(os.listdir(DOSSIER), reverse=True):
            if nom.endswith(".json"):
                try:
                    with open(os.path.join(DOSSIER, nom), encoding="utf-8") as f:
                        d = json.load(f)
                    if d.get("type") == "renfo":
                        continue
                    res.append({"fichier": nom, "debut": d["debut"], "programme": d.get("programme"), **d["resume"]})
                except (OSError, ValueError, KeyError):
                    pass
    return res


# --- Serveur web (bibliothèque standard, sans dépendance) ----------------------

async def serveur_web(seance, capteur, hote):
    async def client(lecteur, ecrivain):
        try:
            ligne = (await lecteur.readline()).decode("latin-1").split()
            longueur = 0
            while (entete := await lecteur.readline()) not in (b"\r\n", b"\n", b""):
                if entete.lower().startswith(b"content-length:"):
                    longueur = int(entete.split(b":")[1])
            donnees = await lecteur.readexactly(longueur) if 0 < longueur < 100000 else b""
            chemin, _, requete = (ligne[1] if len(ligne) > 1 else "/").partition("?")
            params = urllib.parse.parse_qs(requete)
            if chemin == "/flux":
                ecrivain.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                               b"Cache-Control: no-cache\r\n\r\n")
                seance.abonnes.add(ecrivain)
                seance.diffuser()
                await lecteur.read()  # attend la fermeture de la page
                seance.abonnes.discard(ecrivain)
                return
            if chemin == "/historique":
                corps, type_ = json.dumps(historique()).encode(), "application/json"
            elif chemin.startswith("/seance/"):
                nom = os.path.basename(chemin[8:])
                with open(os.path.join(DOSSIER, nom), "rb") as f:
                    corps, type_ = f.read(), "application/json"
            elif chemin == "/nouvelle" and ligne[0] == "POST":
                seance.sauver()
                await capteur.remise_a_zero()
                seance.nouvelle()
                seance.programme = params.get("programme", [None])[0]
                corps, type_ = b"{}", "application/json"
            elif chemin == "/fin" and ligne[0] == "POST":
                seance.termine = True
                pc = params.get("precision", [""])[0]
                seance.precision = int(pc) if pc.isdigit() else None
                seance._modifiee = True
                seance.sauver()
                corps, type_ = b"{}", "application/json"
            elif chemin == "/exercice" and ligne[0] == "POST":  # séance hors rameur terminée
                maintenant = datetime.datetime.now()
                duree = int(params.get("duree", ["0"])[0])
                os.makedirs(DOSSIER, exist_ok=True)
                with open(os.path.join(DOSSIER, maintenant.strftime("%Y-%m-%d_%H%M%S") + "_renfo.json"), "w",
                          encoding="utf-8") as f:
                    json.dump({"debut": (maintenant - datetime.timedelta(seconds=duree)).isoformat(timespec="seconds"),
                               "type": "renfo", "programme": params.get("programme", [""])[0], "termine": True,
                               "resume": {"distance_m": 0, "temps_s": duree}, "points": [], "coups": []}, f)
                corps, type_ = b"{}", "application/json"
            elif chemin == "/jeu":
                corps, type_ = json.dumps(jeu.etat(), ensure_ascii=False, default=str).encode(), "application/json"
            elif chemin == "/profil" and ligne[0] == "POST":
                jeu.enregistrer_profil(json.loads(donnees or b"{}"))
                corps, type_ = b"{}", "application/json"
            elif chemin == "/pesee" and ligne[0] == "POST":
                jeu.ajouter_pesee(float(params["kg"][0].replace(",", ".")))
                corps, type_ = b"{}", "application/json"
            elif chemin == "/illustrations.js":
                with open(os.path.join(ICI, "illustrations.js"), "rb") as f:
                    corps, type_ = f.read(), "text/javascript; charset=utf-8"
            elif chemin == "/version":
                corps, type_ = b'{"version": 3}', "application/json"
            elif chemin == "/recettes":
                with open(os.path.join(ICI, "recettes.json"), "rb") as f:
                    corps, type_ = f.read(), "application/json"
            elif chemin == "/programmes":
                with open(os.path.join(ICI, "programmes.json"), "rb") as f:
                    corps, type_ = f.read(), "application/json"
            else:
                with open(os.path.join(ICI, "page.html"), "rb") as f:
                    corps, type_ = f.read(), "text/html; charset=utf-8"
            ecrivain.write(f"HTTP/1.1 200 OK\r\nContent-Type: {type_}\r\nContent-Length: {len(corps)}\r\n"
                           f"Connection: close\r\n\r\n".encode() + corps)
            await ecrivain.drain()
        except (OSError, IndexError, ValueError, KeyError, asyncio.IncompleteReadError):
            ecrivain.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        finally:
            ecrivain.close()

    return await asyncio.start_server(client, hote, int(_option("--port", PORT)))


# --- Liaison avec le SmartRow, reconnexion automatique ------------------------

class Capteur:
    def __init__(self, seance):
        self.seance = seance
        self.lien = None
        self.premiere = True

    async def remise_a_zero(self):
        if self.lien and self.lien.client:
            await self.lien._ecrire(sr.INIT)

    async def boucle(self, arret):
        while not arret.is_set():
            self.seance.etat["connexion"] = "recherche"
            self.seance.diffuser()
            appareil = await sr.trouver(duree=10.0)
            if appareil is None:
                continue
            self.seance.etat["connexion"] = "connexion"
            self.seance.diffuser()
            self.lien = sr.SmartRow(appareil, self.seance.recu)
            self.lien.au_demarrage = self._connecte
            try:
                await self.lien.lancer(arret, coupure=self._coupure, remise_a_zero=self.premiere)
                self.premiere = False
            except (BleakError, TimeoutError, asyncio.TimeoutError, OSError) as e:
                print(f"Bluetooth : {e or type(e).__name__} ; nouvelle tentative...")
            self.lien = None
            self.seance.sauver()
            await asyncio.sleep(2)

    def _connecte(self):
        self.seance.etat["connexion"] = "ok"
        self.seance.diffuser()
        print("SmartRow connecté.")

    def _coupure(self):
        print("SmartRow déconnecté.")


class Rejeu(Capteur):
    """Rejoue un journal brut de ecouter.py au lieu de lire le Bluetooth."""

    def __init__(self, seance, chemin, vitesse=1.0):
        super().__init__(seance)
        self.chemin, self.vitesse = chemin, vitesse

    async def remise_a_zero(self):
        pass

    async def boucle(self, arret):
        self._connecte()
        precedent = None
        decalage = time.time()
        with open(self.chemin, encoding="utf-8") as f:
            lignes = [l.rstrip("\n").split("\t") for l in f if l.strip()]
        if lignes:
            decalage -= float(lignes[0][0])
        for horo, _hex, brut in lignes:
            h = float(horo)
            if precedent is not None:
                await asyncio.sleep((h - precedent) / self.vitesse)
            precedent = h
            paquet = ast.literal_eval(brut)
            t, v = sr.decoder(paquet)
            self.seance.recu(h + decalage, paquet, t, v)
        print("Fin du rejeu.")


async def principal(hote, rejeu=None, vitesse=1.0):
    seance = Seance()
    capteur = Rejeu(seance, rejeu, vitesse) if rejeu else Capteur(seance)
    arret = asyncio.Event()
    boucle = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        boucle.add_signal_handler(sig, arret.set)
    web = await serveur_web(seance, capteur, hote)
    print(f"Ouvrez http://localhost:{_option('--port', PORT)} dans le navigateur. Ctrl+C pour quitter.")

    async def sauvegarde_reguliere():
        while True:
            await asyncio.sleep(10)
            seance.sauver()

    taches = [asyncio.ensure_future(capteur.boucle(arret)), asyncio.ensure_future(sauvegarde_reguliere())]
    await arret.wait()
    for t in taches:
        t.cancel()
    web.close()
    seance.sauver()
    print("Séance enregistrée. Au revoir.")


def _option(nom, defaut=None):
    return sys.argv[sys.argv.index(nom) + 1] if nom in sys.argv[:-1] else defaut


if __name__ == "__main__":
    asyncio.run(principal("0.0.0.0" if "--reseau" in sys.argv else "127.0.0.1",
                          _option("--rejouer"), float(_option("--vitesse", 1))))
