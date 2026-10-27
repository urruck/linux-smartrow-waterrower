"""Connexion Bluetooth (BLE) au capteur SmartRow d'un WaterRower.

Protocole relevé dans deux logiciels libres qui savent déjà le lire :
QZ (qdomyos-zwift, src/devices/smartrowrower) et pirowflo
(src/adapters/smartrow). Les deux ne sont pas d'accord sur certains champs
(temps, coups/min) : on enregistre donc toujours les messages bruts pour
vérifier sur la vraie machine.

- service 0x1234, écriture 0x1235, notifications 0x1236 ;
- on écrit un octet à la fois ;
- initialisation : « $ » puis CR « V » « @ » CR (remise à zéro), puis « $ »
  toutes les 1 à 2 s pour garder la liaison ;
- SmartRow V3 : il annonce « V3. », on répond « # », il envoie
  « KEYLOCK=… », on répond au défi (calcul repris de QZ) ;
- données : messages texte de 17 caractères ; la 1re lettre donne le type,
  les caractères 1 à 5 la distance totale en mètres.
"""
import asyncio
import time

from bleak import BleakClient, BleakScanner


def _uuid(court):
    return f"0000{court:04x}-0000-1000-8000-00805f9b34fb"


SERVICE = _uuid(0x1234)
ECRITURE = _uuid(0x1235)
NOTIFICATION = _uuid(0x1236)

INIT = b"$\rV@\r"
POLL = b"$"


def reponse_defi_v3(message):
    """Réponse au défi « KEYLOCK=… » des SmartRow V3 (repris de QZ)."""
    texte = message.strip()
    i = texte.find(b"KEYLOCK=")
    if i >= 0:
        texte = texte[i:]
    if len(texte) < 16:
        return b"#"
    cle, somme = texte[:14], texte[14:16].upper()
    if f"{sum(cle):04X}"[-2:].encode() != somme:
        return b"#"
    try:
        graine = int(texte[10:14], 16)
    except ValueError:
        return b"#"
    rep = f"{graine * 17923 // 256:06x}"[-4:]
    return b"\r" + rep.encode() + b"\r"


def _ent(texte):
    try:
        return int(texte.replace(" ", "0"))
    except ValueError:
        return None


def _mmss(texte):
    """« 312 » -> 192 s (3 min 12) ; « 00104 » -> 64 s."""
    m, s = _ent(texte[:-2]), _ent(texte[-2:])
    return None if None in (m, s) else m * 60 + s


def checksum_ok(paquet):
    """Les 2 caractères avant le CR = somme des 14 premiers octets, en hexadécimal."""
    return len(paquet) == 17 and f"{sum(paquet[:14]) & 0xFF:02X}".encode() == paquet[14:16]


def decoder(paquet, v3=False):
    """Décode un message de 17 octets (16 caractères + CR).
    Formats vérifiés sur un SmartRow V2 le 27/10/2026 (séance réelle de 260 m).
    Renvoie (type, {grandeur: valeur}) ou (None, {}) si le message est invalide."""
    if len(paquet) != 17:
        return None, {}
    p = bytearray(paquet)
    if v3 and chr(p[0]) in "abcdefxyz":
        for i in range(1, 6):
            p[i] = (p[i] & 0x0F) | 0x30
    p = bytes(p)
    if not v3 and not checksum_ok(p):
        return None, {}
    s = p.decode("ascii", "replace")
    t = s[0]
    if t == "f":  # distance en décimètres sur 6 chiffres
        dm = _ent(s[1:7])
        return t, {"distance_m": dm / 10 if dm is not None else None,
                   "valeur_f": _ent(s[7:11]),   # sens inconnu (≈ 460 au repos)
                   "arret": s[11] == "!"}
    v = {"distance_m": _ent(s[1:6])}
    if t == "a":
        v["temps_s"] = _mmss(s[6:11])           # minutes sur 3 chiffres + secondes
    elif t == "b":
        travail = _ent(s[7:11])
        v["travail_j"] = travail / 10 if travail is not None else None
        v["longueur_coup"] = _ent(s[11:14])     # unité à confirmer
    elif t == "c":
        v["watts"] = _ent(s[6:9])
        moy = _ent(s[9:14])
        v["watts_moyens"] = moy / 10 if moy is not None else None
    elif t == "d":
        cad = _ent(s[6:9])
        v["cadence"] = cad / 10 if cad is not None else None   # coups/min
        v["coups"] = _ent(s[9:13])
    elif t == "e":
        v["allure_500m_s"] = _mmss(s[6:9])
        v["allure_moyenne_s"] = _mmss(s[9:12])
    elif t in "xyz":  # courbe de force : 3 messages x, y, z de 8 points (caractère - 33)
        v["courbe"] = [c - 33 for c in p[6:14]]
    return t, v


async def trouver(nom="SmartRow", duree=15.0):
    """Cherche un SmartRow à proximité (par son nom ou son service)."""
    appareils = await BleakScanner.discover(timeout=duree, return_adv=True)
    for app, pub in appareils.values():
        n = (pub.local_name or app.name or "")
        if nom.lower() in n.lower() or SERVICE in [u.lower() for u in pub.service_uuids]:
            return app
    return None


class SmartRow:
    """Connexion au capteur. Appelle rappel(horodatage, octets bruts, type, valeurs)."""

    def __init__(self, appareil, rappel):
        self.appareil = appareil
        self.rappel = rappel
        self.v3 = False
        self._defi_demande = False
        self._a_ecrire = asyncio.Queue()
        self.client = None

    async def _ecrire(self, octets):
        for b in octets:
            await self._a_ecrire.put(bytes([b]))

    def _recu(self, _carac, donnees):
        donnees = bytes(donnees)
        if b"V3." in donnees:
            self.v3 = True
            if not self._defi_demande:
                self._defi_demande = True
                asyncio.ensure_future(self._ecrire(b"#"))
        elif b"KEYLOCK" in donnees:
            self.v3 = True
            asyncio.ensure_future(self._ecrire(reponse_defi_v3(donnees)))
        t, v = decoder(donnees, self.v3)
        self.rappel(time.time(), donnees, t, v)

    async def _ecrivain(self):
        while True:
            b = await self._a_ecrire.get()
            await self.client.write_gatt_char(ECRITURE, b, response=False)
            await asyncio.sleep(0.03)

    async def _veille(self):
        while True:
            await asyncio.sleep(1.5)
            await self._ecrire(POLL)

    au_demarrage = None

    async def lancer(self, arret, coupure=None, remise_a_zero=True):
        """Se connecte et lit jusqu'à ce que « arret » soit levé ou que la liaison
        soit coupée. remise_a_zero : remet le compteur du SmartRow à zéro."""
        perdu = asyncio.Event()

        def deconnecte(_client):
            perdu.set()
            if coupure:
                coupure()

        async with BleakClient(self.appareil, timeout=25.0, disconnected_callback=deconnecte) as client:
            self.client = client
            await client.start_notify(NOTIFICATION, self._recu)
            taches = [asyncio.ensure_future(self._ecrivain()), asyncio.ensure_future(self._veille())]
            await self._ecrire(POLL)
            if remise_a_zero:
                await asyncio.sleep(1.0)
                await self._ecrire(INIT)
            if self.au_demarrage:
                self.au_demarrage()
            try:
                fin = [asyncio.ensure_future(arret.wait()), asyncio.ensure_future(perdu.wait())]
                await asyncio.wait(fin, return_when=asyncio.FIRST_COMPLETED)
                for f in fin:
                    f.cancel()
            finally:
                for t in taches:
                    t.cancel()
                self.client = None
