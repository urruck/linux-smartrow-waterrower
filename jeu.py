"""Mode Aventure : XP, niveaux, descente de la Loire, badges, quêtes, plan
sur 12 semaines, poids et récompenses personnelles.

Tout est recalculé à partir des séances enregistrées (sessions/*.json) et du
dossier donnees/ (profil.json, pesees.json). Rien n'est stocké en double :
modifier une règle dans jeu.json s'applique à tout l'historique.
"""
import datetime
import json
import os

ICI = os.path.dirname(os.path.abspath(__file__))
SESSIONS = os.path.join(ICI, "sessions")
DONNEES = os.path.join(ICI, "donnees")

PROFIL_DEFAUT = {
    "prenom": "",
    "taille_cm": 163,
    "poids_depart_kg": 76.0,
    "poids_objectif_kg": 70.0,
    "debut": None,              # date du début du plan (AAAA-MM-JJ), fixée au premier lancement
    "recompenses": [
        {"condition": "poids:-2", "texte": "À définir : une petite récompense (ciné, livre…)"},
        {"condition": "escale:Chalonnes-sur-Loire", "texte": "À définir"},
        {"condition": "niveau:5", "texte": "À définir : un équipement de sport ?"},
        {"condition": "poids:-4", "texte": "À définir"},
        {"condition": "poids:objectif", "texte": "À définir : la grosse récompense !"},
    ],
}


def _lire(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def _ecrire(chemin, donnees):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, indent=2)
    os.replace(tmp, chemin)


def regles():
    return _lire(os.path.join(ICI, "jeu.json"), {})


def profil():
    p = {**PROFIL_DEFAUT, **_lire(os.path.join(DONNEES, "profil.json"), {})}
    if not p.get("debut"):
        p["debut"] = datetime.date.today().isoformat()
        _ecrire(os.path.join(DONNEES, "profil.json"), p)
    return p


def enregistrer_profil(maj):
    p = profil()
    for k in ("prenom", "taille_cm", "poids_depart_kg", "poids_objectif_kg", "debut", "recompenses"):
        if k in maj:
            p[k] = maj[k]
    _ecrire(os.path.join(DONNEES, "profil.json"), p)
    return p


def pesees():
    return sorted(_lire(os.path.join(DONNEES, "pesees.json"), []), key=lambda x: x["date"])


def ajouter_pesee(kg, date=None):
    date = date or datetime.date.today().isoformat()
    liste = [x for x in pesees() if x["date"] != date] + [{"date": date, "kg": round(float(kg), 1)}]
    _ecrire(os.path.join(DONNEES, "pesees.json"), sorted(liste, key=lambda x: x["date"]))


def kcal(points, poids_kg):
    """Dépense estimée (formule ACSM utilisée aussi par QZ) : par minute,
    (0,048 × watts + 1,19) × poids × 3,5 / 200. Un point = une seconde."""
    return sum((0.048 * (p.get("watts") or 0) + 1.19) * poids_kg * 3.5 / 200 / 60 for p in points)


def seances(poids_kg):
    """Séances enregistrées, de la plus ancienne à la plus récente, avec leurs chiffres."""
    noms = {p["nom"]: p["id"] for p in _lire(os.path.join(ICI, "programmes.json"), {}).get("programmes", [])}
    res = []
    if not os.path.isdir(SESSIONS):
        return res
    for nom in sorted(os.listdir(SESSIONS)):
        if not nom.endswith(".json"):
            continue
        d = _lire(os.path.join(SESSIONS, nom), None)
        if not d or "resume" not in d:
            continue
        r = d["resume"]
        debut = datetime.datetime.fromisoformat(d["debut"])
        res.append({
            "fichier": nom, "debut": debut, "programme": d.get("programme"),
            "programme_id": noms.get(d.get("programme")), "termine": bool(d.get("termine")),
            "precision": d.get("precision_cadence"), "renfo": d.get("type") == "renfo",
            "distance_m": r.get("distance_m") or 0, "temps_s": r.get("temps_s") or 0,
            "allure_moyenne_s": r.get("allure_moyenne_s"), "kcal": kcal(d.get("points", []), poids_kg),
        })
    return res


def _xp_niveau(n):
    return 500 * n * (n - 1) // 2


def etat():
    """Tout l'état du jeu, prêt à afficher."""
    R, P = regles(), profil()
    xp_r = R.get("xp", {})
    pes = pesees()
    poids_actuel = pes[-1]["kg"] if pes else P["poids_depart_kg"]
    liste = seances(poids_actuel)
    debut_plan = datetime.date.fromisoformat(P["debut"])
    lundi0 = debut_plan  # les semaines du plan partent du jour de début
    semaine_de = lambda d: (d.date() - lundi0).days // 7 + 1  # noqa: E731
    plan = R.get("plan", {}).get("semaines", [])
    aujourd_hui = datetime.date.today()
    semaine = (aujourd_hui - lundi0).days // 7 + 1

    # --- XP par séance, plan par semaine
    xp = 0
    journal = []
    par_semaine = {}
    for s in liste:
        n = semaine_de(s["debut"])
        s["semaine"] = n
        par_semaine.setdefault(n, []).append(s)
    plan_fait, renfo_faits = {}, {}
    for n, ss in par_semaine.items():
        attendues = list(plan[n - 1]["seances"]) if 0 < n <= len(plan) else []
        renfo_att = list(plan[n - 1].get("renfo", [])) if 0 < n <= len(plan) else []
        faites, renfo_faits[n] = [], []
        for s in ss:
            if s["renfo"]:
                s["xp"] = xp_r.get("seance_renfo", 80) if s["termine"] else 0
                if s["programme_id"] in renfo_att:
                    renfo_att.remove(s["programme_id"])
                    renfo_faits[n].append(s["programme_id"])
                xp += s["xp"]
                continue
            gain = int(s["distance_m"] / 100 * xp_r.get("par_100m", 10))
            if s["temps_s"] >= 600:
                gain += xp_r.get("seance_10min", 50)
            if s["programme"] and s["termine"]:
                gain += xp_r.get("seance_guidee_terminee", 100)
                if s["programme_id"] in attendues:
                    attendues.remove(s["programme_id"])
                    faites.append(s["programme_id"])
                    gain += xp_r.get("seance_du_plan", 50)
            if s["termine"] and s["precision"] is not None:
                gain += round(s["precision"] / 100 * xp_r.get("precision_cadence_max", 100))
            s["xp"] = gain
            xp += gain
        plan_fait[n] = faites
    journal = [{"date": s["debut"].isoformat(timespec="minutes"), "programme": s["programme"] or "Séance libre",
                "distance_m": s["distance_m"], "temps_s": s["temps_s"], "kcal": round(s["kcal"]),
                "precision": s["precision"], "renfo": s["renfo"],
                "xp": s["xp"]} for s in reversed(liste[-15:])]

    renfos = [s for s in liste if s["renfo"] and s["termine"]]
    liste = [s for s in liste if not s["renfo"]]   # la suite ne concerne que la rame
    par_semaine = {n: [s for s in ss if not s["renfo"]] for n, ss in par_semaine.items()}
    renfo_semaine = {}
    for s in renfos:
        renfo_semaine.setdefault(s["semaine"], []).append(s)
    total_m = sum(s["distance_m"] for s in liste)
    total_kcal = sum(s["kcal"] for s in liste)
    perdu = round(P["poids_depart_kg"] - poids_actuel, 1)
    a_perdre = round(P["poids_depart_kg"] - P["poids_objectif_kg"], 1)

    # --- Parcours
    esc = R.get("parcours", {}).get("escales", [])
    km = total_m / 1000
    atteintes = [e for e in esc if e["km"] <= km]
    prochaine = next((e for e in esc if e["km"] > km), None)

    # --- Semaines complètes (3 séances) pour les badges de régularité
    def complete(n):
        return len(par_semaine.get(n, [])) >= 3
    serie = 0
    meilleure_serie = 0
    for n in range(1, max(par_semaine or [0], default=0) + 1):
        serie = serie + 1 if complete(n) else 0
        meilleure_serie = max(meilleure_serie, serie)

    tests = [s for s in liste if s["programme_id"] == "test1000" and s["termine"] and s["allure_moyenne_s"]]
    record = len(tests) >= 2 and min(t["allure_moyenne_s"] for t in tests[1:]) < tests[0]["allure_moyenne_s"]

    conditions = {
        "premiere": len(liste) >= 1, "km1": km >= 1, "km10": km >= 10, "km42": km >= 42.195, "km100": km >= 100,
        "seance5k": any(s["distance_m"] >= 5000 for s in liste),
        "seance30": any(s["temps_s"] >= 1800 for s in liste),
        "semaine3": any(complete(n) for n in par_semaine), "serie4": meilleure_serie >= 4,
        "matinal": any(s["debut"].hour < 8 for s in liste),
        "guide5": sum(1 for s in liste if s["programme"] and s["termine"]) >= 5,
        "reprise": len(plan_fait.get(1, [])) >= 3 and len(plan_fait.get(2, [])) >= 3,
        "fractionne": any(s["termine"] and s["programme_id"] in ("fractionne3030", "pyramide") for s in liste),
        "metronome": any((s["precision"] or 0) >= 80 for s in liste),
        "horloger": sum(1 for s in liste if (s["precision"] or 0) >= 80) >= 5,
        "gaine": sum(1 for s in renfos if s["programme_id"] in ("ventre1", "ventre2")) >= 5,
        "gaine20": sum(1 for s in renfos if s["programme_id"] in ("ventre1", "ventre2")) >= 20,
        "cheville6": sum(1 for s in renfos if s["programme_id"] == "cheville") >= 6,
        "record1000": record, "kcal1000": total_kcal >= 1000, "kcal5000": total_kcal >= 5000,
        "poids1": perdu >= 1, "poids3": perdu >= 3, "poids_obj": pes != [] and poids_actuel <= P["poids_objectif_kg"],
        "chalonnes": km >= 68, "nantes": km >= 135, "ocean": km >= 190,
    }
    badges = [{**b, "obtenu": bool(conditions.get(b["id"]))} for b in R.get("badges", [])]
    xp += sum(1 for b in badges if b["obtenu"]) * xp_r.get("badge", 100)

    # --- Quêtes de la semaine en cours
    km_cible = round(min(20, 3 + 1.2 * (semaine - 1)), 1)
    ss = par_semaine.get(semaine, [])
    km_semaine = sum(s["distance_m"] for s in ss) / 1000
    lundi = lundi0 + datetime.timedelta(weeks=semaine - 1)
    pesee_semaine = any(lundi.isoformat() <= p["date"] < (lundi + datetime.timedelta(days=7)).isoformat() for p in pes)
    avant_debut = semaine < 1
    plan_semaine = plan[0] if avant_debut and plan else (plan[semaine - 1] if 0 < semaine <= len(plan) else None)
    quetes = []
    for q in R.get("quetes", []):
        if q["id"] == "plan" and plan_semaine:
            fait, but = len(plan_fait.get(semaine, [])), len(plan_semaine["seances"])
        elif q["id"] == "km":
            fait, but = round(km_semaine, 1), km_cible
        elif q["id"] == "renfo":
            fait, but = len(renfo_semaine.get(semaine, [])), 2
        elif q["id"] == "cadence":
            fait, but = sum(1 for s in ss if (s["precision"] or 0) >= 75), 2
        elif q["id"] == "pesee":
            fait, but = int(pesee_semaine), 1
        else:
            continue
        quetes.append({"texte": q["texte"].format(km=km_cible), "fait": fait, "but": but, "ok": fait >= but})
    # quêtes réussies des semaines passées (XP)
    for n in range(1, semaine):
        km_n = sum(s["distance_m"] for s in par_semaine.get(n, [])) / 1000
        if km_n >= min(20, 3 + 1.2 * (n - 1)):
            xp += xp_r.get("quete", 150)
        if 0 < n <= len(plan) and len(plan_fait.get(n, [])) >= len(plan[n - 1]["seances"]):
            xp += xp_r.get("quete", 150)
    if avant_debut:
        quetes = []
    xp += sum(xp_r.get("quete", 150) for q in quetes if q["ok"] and "pesee" not in q["texte"])

    # --- Niveau
    noms = R.get("niveaux", ["Niveau"])
    n = 1
    while _xp_niveau(n + 1) <= xp:
        n += 1
    niveau = {"numero": n, "nom": noms[min(n, len(noms)) - 1], "xp": xp,
              "xp_debut": _xp_niveau(n), "xp_suivant": _xp_niveau(n + 1)}

    # --- Récompenses personnelles
    def debloquee(cond):
        genre, _, val = cond.partition(":")
        if genre == "poids":
            return conditions["poids_obj"] if val == "objectif" else perdu >= abs(float(val))
        if genre == "escale":
            return any(e["nom"] == val for e in atteintes)
        if genre == "niveau":
            return n >= int(val)
        if genre == "km":
            return km >= float(val)
        return False
    recompenses = [{**r, "obtenue": debloquee(r["condition"])} for r in P.get("recompenses", [])]

    # --- Séances du plan restant à faire cette semaine
    a_faire, renfo_a_faire = [], []
    if plan_semaine:
        a_faire = list(plan_semaine["seances"])
        renfo_a_faire = list(plan_semaine.get("renfo", []))
        if not avant_debut:
            for f in plan_fait.get(semaine, []):
                a_faire.remove(f)
            for f in renfo_faits.get(semaine, []):
                renfo_a_faire.remove(f)

    return {
        "profil": P, "niveau": niveau, "xp_total": xp,
        "totaux": {"km": round(km, 2), "seances": len(liste), "renfo": len(renfos), "kcal": round(total_kcal),
                   "temps_s": sum(s["temps_s"] for s in liste)},
        "poids": {"depart": P["poids_depart_kg"], "objectif": P["poids_objectif_kg"], "actuel": poids_actuel,
                  "perdu": perdu, "a_perdre": a_perdre, "pesees": pes},
        "parcours": {"nom": R.get("parcours", {}).get("nom"), "km": round(km, 2), "escales": esc,
                     "derniere": atteintes[-1] if atteintes else None, "prochaine": prochaine,
                     "total_km": esc[-1]["km"] if esc else 0},
        "badges": badges,
        "semaine": {"numero": semaine, "avant_debut": avant_debut, "debut": P["debut"], "renfo_a_faire": renfo_a_faire,
                    "theme": plan_semaine["theme"] if plan_semaine else "Plan terminé : continuez à votre rythme",
                    "nb_semaines": len(plan), "plan": plan_semaine["seances"] if plan_semaine else [],
                    "a_faire": a_faire, "km": round(km_semaine, 1), "nb_seances": len(ss)},
        "quetes": quetes, "recompenses": recompenses, "journal": journal,
    }


if __name__ == "__main__":
    print(json.dumps(etat(), ensure_ascii=False, indent=1, default=str)[:3000])
