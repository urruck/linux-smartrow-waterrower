"""Sauvegarde et transfert des données entre le PC et le téléphone.

Un seul fichier JSON contient tout : les séances (sessions/*.json), le
profil et les pesées. Le même format est lu et écrit par l'application
Android (mobile/src/serveur.js).

À l'import, rien n'est effacé : les séances absentes sont ajoutées, les
pesées des jours absents aussi ; le profil n'est remplacé que si on le
demande.
"""
import datetime
import json
import os
import re
import subprocess

from chemins import DONNEES, SESSIONS

FORMAT = "rameur-smartrow"
NOM_VALIDE = re.compile(r"[0-9A-Za-z_-]+\.json")


def _lire(chemin, defaut=None):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def _ecrire(chemin, donnees):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False)
    os.replace(tmp, chemin)


def exporter(appareil="linux"):
    """Toutes les données, prêtes à écrire dans un fichier."""
    seances = {}
    if os.path.isdir(SESSIONS):
        for nom in sorted(os.listdir(SESSIONS)):
            if NOM_VALIDE.fullmatch(nom):
                d = _lire(os.path.join(SESSIONS, nom))
                if d is not None:
                    seances[nom] = d
    donnees = {}
    for nom in ("profil.json", "pesees.json"):
        d = _lire(os.path.join(DONNEES, nom))
        if d is not None:
            donnees[nom] = d
    return {"format": FORMAT, "version": 1, "appareil": appareil,
            "cree": datetime.datetime.now().isoformat(timespec="seconds"),
            "sessions": seances, "donnees": donnees}


def dossier_telechargements():
    try:
        d = subprocess.run(["xdg-user-dir", "DOWNLOAD"], capture_output=True, text=True, timeout=5).stdout.strip()
        if d and os.path.isdir(d):
            return d
    except (OSError, subprocess.SubprocessError):
        pass
    for nom in ("Téléchargements", "Downloads"):
        d = os.path.join(os.path.expanduser("~"), nom)
        if os.path.isdir(d):
            return d
    return os.path.expanduser("~")


def enregistrer_export():
    """Écrit la sauvegarde dans le dossier Téléchargements ; renvoie un message."""
    d = exporter()
    chemin = os.path.join(dossier_telechargements(),
                          f"rameur-sauvegarde-{datetime.date.today().isoformat()}.json")
    _ecrire(chemin, d)
    court = chemin.replace(os.path.expanduser("~"), "~", 1)
    return {"chemin": chemin, "seances": len(d["sessions"]),
            "message": f"Sauvegarde enregistrée ({len(d['sessions'])} séances) : {court}"}


def fusionner(d, remplacer_profil=False):
    """Ajoute les données d'une sauvegarde ; renvoie un résumé lisible."""
    if not isinstance(d, dict) or d.get("format") != FORMAT:
        raise ValueError("Ce fichier n'est pas une sauvegarde du rameur.")
    ajoutees = presentes = 0
    for nom, contenu in (d.get("sessions") or {}).items():
        if not NOM_VALIDE.fullmatch(nom) or not isinstance(contenu, dict):
            continue
        chemin = os.path.join(SESSIONS, nom)
        if os.path.exists(chemin):
            presentes += 1
        else:
            _ecrire(chemin, contenu)
            ajoutees += 1
    donnees = d.get("donnees") or {}
    pes = _lire(os.path.join(DONNEES, "pesees.json"), [])
    dates = {p["date"] for p in pes}
    nouvelles = [p for p in donnees.get("pesees.json") or []
                 if isinstance(p, dict) and "date" in p and "kg" in p and p["date"] not in dates]
    if nouvelles:
        _ecrire(os.path.join(DONNEES, "pesees.json"), sorted(pes + nouvelles, key=lambda p: p["date"]))
    profil = remplacer_profil and isinstance(donnees.get("profil.json"), dict)
    if profil:
        _ecrire(os.path.join(DONNEES, "profil.json"), donnees["profil.json"])
    message = f"{ajoutees} séance(s) ajoutée(s), {presentes} déjà présente(s), {len(nouvelles)} pesée(s) ajoutée(s)"
    if profil:
        message += ", profil remplacé"
    return {"seances_ajoutees": ajoutees, "seances_presentes": presentes,
            "pesees_ajoutees": len(nouvelles), "profil": profil, "message": message + "."}
