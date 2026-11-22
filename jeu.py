"""Mode Aventure : XP, niveaux, descente de la Loire, badges, quêtes, plan
sur 12 semaines (rame, renfo, course à pied), poids et récompenses personnelles.

Tout est recalculé à partir des séances enregistrées (sessions/*.json) et du
dossier donnees/ (profil.json, pesees.json). Rien n'est stocké en double :
modifier une règle dans jeu.json s'applique à tout l'historique.
"""
import datetime
import json
import math
import os

ICI = os.path.dirname(os.path.abspath(__file__))
from chemins import SESSIONS, DONNEES  # noqa: E402  (données dans ~/.local/share)

PROFIL_DEFAUT = {
    "prenom": "",
    "taille_cm": 163,
    "poids_depart_kg": 76.0,
    "poids_objectif_kg": 70.0,
    "debut": None,              # date du début du plan (AAAA-MM-JJ), fixée au premier lancement
    "aventure_depuis": None,    # remise à zéro : les séances d'avant ne comptent plus dans l'aventure
    # jours d'entraînement, du lundi au dimanche : rame, course, renfo ou repos
    "semainier": ["rame", "renfo", "rame", "repos", "rame", "course", "renfo"],
    "remplacements": {},        # « semaine:type:rang » -> id du programme qui remplace celui du plan
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
    for k in ("prenom", "taille_cm", "poids_depart_kg", "poids_objectif_kg", "debut", "recompenses",
              "semainier", "remplacements"):
        if k in maj:
            p[k] = maj[k]
    _ecrire(os.path.join(DONNEES, "profil.json"), p)
    return p


def redemarrer(debut=None, poids_depart_kg=None, poids_objectif_kg=None):
    """Remet l'aventure à zéro à la date donnée (aujourd'hui par défaut) : XP, niveau,
    badges, parcours, quêtes et plan repartent de zéro. Les séances restent dans
    l'historique ; le prénom, les récompenses et les jours choisis sont gardés."""
    p = profil()
    debut = debut or datetime.date.today().isoformat()
    datetime.date.fromisoformat(debut)   # vérifie la date
    p["debut"] = p["aventure_depuis"] = debut
    p["remplacements"] = {}
    if poids_depart_kg:
        p["poids_depart_kg"] = round(float(poids_depart_kg), 1)
    if poids_objectif_kg:
        p["poids_objectif_kg"] = round(float(poids_objectif_kg), 1)
    _ecrire(os.path.join(DONNEES, "profil.json"), p)
    return p


def meilleur_temps(serie, longueur):
    """Temps le plus court pour parcourir « longueur » mètres dans une suite de (temps, distance)."""
    meilleur, j = None, 0
    for i in range(len(serie)):
        j = max(j, i)
        while j < len(serie) and serie[j][1] - serie[i][1] < longueur:
            j += 1
        if j == len(serie):
            break
        dt = serie[j][0] - serie[i][0]
        if meilleur is None or dt < meilleur:
            meilleur = dt
    return meilleur


def pesees():
    return sorted(_lire(os.path.join(DONNEES, "pesees.json"), []), key=lambda x: x["date"])


def ajouter_pesee(kg, date=None):
    date = date or datetime.date.today().isoformat()
    liste = [x for x in pesees() if x["date"] != date] + [{"date": date, "kg": round(float(kg), 1)}]
    _ecrire(os.path.join(DONNEES, "pesees.json"), sorted(liste, key=lambda x: x["date"]))


def kcal_course(distance_m, poids_kg):
    """Course à pied (et marche rapide) : environ 1 kcal par kg et par km."""
    return distance_m / 1000 * poids_kg


def kcal(points, poids_kg):
    """Dépense estimée (formule ACSM utilisée aussi par QZ) : par minute,
    (0,048 × watts + 1,19) × poids × 3,5 / 200. Un point = une seconde."""
    return sum((0.048 * (p.get("watts") or 0) + 1.19) * poids_kg * 3.5 / 200 / 60 for p in points)


def seances(poids_kg, depuis=None):
    """Séances enregistrées (depuis la date donnée), de la plus ancienne à la plus récente."""
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
        if depuis and debut.date().isoformat() < depuis:
            continue
        course = d.get("type") == "course"
        if course:
            km = d.get("km") or []
            trace = [(p[0], p[4]) for p in d.get("trace") or [] if len(p) >= 5]
            m1 = min((km[i] - (km[i - 1] if i else 0) for i in range(len(km))), default=None)
            m500, m1000, m5000 = None, m1, meilleur_temps(trace, 5000)
        else:
            serie = [(p["t"], p["distance_m"]) for p in d.get("points", []) if p.get("distance_m") is not None]
            m500, m1000, m5000 = meilleur_temps(serie, 500), meilleur_temps(serie, 1000), None
        res.append({
            "fichier": nom, "debut": debut, "programme": d.get("programme"),
            "programme_id": noms.get(d.get("programme")), "termine": bool(d.get("termine")),
            "precision": d.get("precision_cadence"), "renfo": d.get("type") == "renfo", "course": course,
            "distance_m": r.get("distance_m") or 0, "temps_s": r.get("temps_s") or 0,
            "allure_moyenne_s": r.get("allure_moyenne_s"), "watts_moyens": r.get("watts_moyens"),
            "m500": m500, "m1000": m1000, "m5000": m5000,
            "kcal": kcal_course(r.get("distance_m") or 0, poids_kg) if course else kcal(d.get("points", []), poids_kg),
        })
    return res


def _dixieme(x):
    """Arrondi au dixième, calculé de la même façon en JavaScript (pas d'écart sur les 0,x5)."""
    return math.floor(x * 10 + 0.5) / 10


def _xp_niveau(n):
    return 500 * n * (n - 1) // 2


def etat():
    """Tout l'état du jeu, prêt à afficher."""
    R, P = regles(), profil()
    xp_r = R.get("xp", {})
    pes = pesees()
    poids_actuel = pes[-1]["kg"] if pes else P["poids_depart_kg"]
    depuis = P.get("aventure_depuis")
    liste = seances(poids_actuel, depuis)
    debut_plan = datetime.date.fromisoformat(P["debut"])
    lundi0 = debut_plan  # les semaines du plan partent du jour de début
    semaine_de = lambda d: (d.date() - lundi0).days // 7 + 1  # noqa: E731
    plan = R.get("plan", {}).get("semaines", [])
    rempl = P.get("remplacements") or {}

    def plan_de(n):
        """La semaine n du plan, avec les séances remplacées par l'utilisateur."""
        if not 0 < n <= len(plan):
            return None
        res = dict(plan[n - 1])
        for cle in ("seances", "renfo", "course"):
            res[cle] = [rempl.get(f"{n}:{cle}:{i}") or x for i, x in enumerate(plan[n - 1].get(cle, []))]
        return res
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
    plan_fait, renfo_faits, course_faites = {}, {}, {}
    for n, ss in par_semaine.items():
        pn = plan_de(n) or {}
        attendues = list(pn.get("seances", []))
        renfo_att = list(pn.get("renfo", []))
        course_att = list(pn.get("course", []))
        faites, renfo_faits[n], course_faites[n] = [], [], []
        for s in ss:
            if s["course"]:
                gain = int(s["distance_m"] / 1000 * xp_r.get("par_km_course", 100))
                if s["temps_s"] >= 600:
                    gain += xp_r.get("seance_10min", 50)
                if s["programme"] and s["termine"]:
                    gain += xp_r.get("seance_guidee_terminee", 100)
                    if s["programme_id"] in course_att:
                        course_att.remove(s["programme_id"])
                        course_faites[n].append(s["programme_id"])
                        gain += xp_r.get("seance_du_plan", 50)
                s["xp"] = gain
                xp += gain
                continue
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
                "precision": s["precision"], "renfo": s["renfo"], "course": s["course"],
                "xp": s["xp"]} for s in reversed(liste[-15:])]

    toutes = liste
    renfos = [s for s in liste if s["renfo"] and s["termine"]]
    courses = [s for s in liste if s["course"]]
    liste = [s for s in liste if not s["renfo"] and not s["course"]]   # la suite ne concerne que la rame
    rame_semaines = {n for n, ss in par_semaine.items() if any(not s["renfo"] and not s["course"] for s in ss)}
    course_semaine = {}
    for s in courses:
        course_semaine.setdefault(s["semaine"], []).append(s)
    par_semaine = {n: [s for s in ss if not s["renfo"] and not s["course"]] for n, ss in par_semaine.items()}
    renfo_semaine = {}
    for s in renfos:
        renfo_semaine.setdefault(s["semaine"], []).append(s)
    total_m = sum(s["distance_m"] for s in liste)
    course_m = sum(s["distance_m"] for s in courses)
    total_kcal = sum(s["kcal"] for s in liste) + sum(s["kcal"] for s in courses)
    perdu = round(P["poids_depart_kg"] - poids_actuel, 1)
    a_perdre = round(P["poids_depart_kg"] - P["poids_objectif_kg"], 1)

    # --- Parcours
    esc = R.get("parcours", {}).get("escales", [])
    km = total_m / 1000
    atteintes = [e for e in esc if e["km"] <= km]
    prochaine = next((e for e in esc if e["km"] > km), None)
    esc_c = R.get("parcours_course", {}).get("escales", [])
    km_c = course_m / 1000
    atteintes_c = [e for e in esc_c if e["km"] <= km_c]

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
        "course1": len(courses) >= 1, "course5k": any(s["distance_m"] >= 5000 for s in courses),
        "course10": len(courses) >= 10, "course25": course_m >= 25000,
        "duathlon": any(n in rame_semaines for n in course_semaine),
        "sentier": bool(esc_c) and km_c >= esc_c[-1]["km"],
    }

    # --- Défis du mois (mois civils depuis le début de l'aventure)
    mois_courant = aujourd_hui.isoformat()[:7]
    par_mois = {}
    for s in toutes:
        par_mois.setdefault(s["debut"].date().isoformat()[:7], []).append(s)
    premier_mois = min([mois_courant] + list(par_mois))

    def defis_du_mois(m):
        ss = par_mois.get(m, [])
        res = []
        for d in R.get("defis", []):
            if d["id"] == "km_rame":
                fait = _dixieme(sum(s["distance_m"] for s in ss if not s["renfo"] and not s["course"]) / 1000)
            elif d["id"] == "km_course":
                fait = _dixieme(sum(s["distance_m"] for s in ss if s["course"]) / 1000)
            elif d["id"] == "seances":
                fait = sum(1 for s in ss if (s["renfo"] and s["termine"]) or not s["renfo"])
            elif d["id"] == "cadence":
                fait = sum(1 for s in ss if not s["renfo"] and not s["course"] and (s["precision"] or 0) >= 80)
            else:
                continue
            res.append({"id": d["id"], "texte": d["texte"].format(but=d["but"]), "fait": fait, "but": d["but"],
                        "ok": fait >= d["but"]})
        return res
    defis = defis_du_mois(mois_courant)
    defis_reussis = sum(1 for d in defis if d["ok"])
    a, m = int(premier_mois[:4]), int(premier_mois[5:])
    while f"{a:04d}-{m:02d}" < mois_courant:
        defis_reussis += sum(1 for d in defis_du_mois(f"{a:04d}-{m:02d}") if d["ok"])
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    conditions["defi1"] = defis_reussis >= 1
    conditions["defis5"] = defis_reussis >= 5
    xp += defis_reussis * xp_r.get("defi", 200)
    badges = [{**b, "obtenu": bool(conditions.get(b["id"]))} for b in R.get("badges", [])]
    xp += sum(1 for b in badges if b["obtenu"]) * xp_r.get("badge", 100)

    # --- Quêtes de la semaine en cours
    km_cible = round(min(20, 3 + 1.2 * (semaine - 1)), 1)
    ss = par_semaine.get(semaine, [])
    km_semaine = sum(s["distance_m"] for s in ss) / 1000
    lundi = lundi0 + datetime.timedelta(weeks=semaine - 1)
    pesee_semaine = any(lundi.isoformat() <= p["date"] < (lundi + datetime.timedelta(days=7)).isoformat() for p in pes)
    avant_debut = semaine < 1
    plan_semaine = plan_de(1) if avant_debut else plan_de(semaine)
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
        elif q["id"] == "course" and plan_semaine and plan_semaine.get("course"):
            fait, but = len(course_faites.get(semaine, [])), len(plan_semaine["course"])
        else:
            continue
        quetes.append({"texte": q["texte"].format(km=km_cible), "fait": fait, "but": but, "ok": fait >= but})
    # quêtes réussies des semaines passées (XP)
    for n in range(1, semaine):
        km_n = sum(s["distance_m"] for s in par_semaine.get(n, [])) / 1000
        if km_n >= min(20, 3 + 1.2 * (n - 1)):
            xp += xp_r.get("quete", 150)
        if 0 < n <= len(plan) and len(plan_fait.get(n, [])) >= len(plan_de(n)["seances"]):
            xp += xp_r.get("quete", 150)
        if 0 < n <= len(plan) and plan_de(n).get("course") and \
                len(course_faites.get(n, [])) >= len(plan_de(n)["course"]):
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
        if genre == "sentier":
            return any(e["nom"] == val for e in atteintes_c)
        return False
    recompenses = [{**r, "obtenue": debloquee(r["condition"])} for r in P.get("recompenses", [])]

    # --- Séances du plan restant à faire cette semaine
    a_faire, renfo_a_faire, course_a_faire = [], [], []
    if plan_semaine:
        a_faire = list(plan_semaine["seances"])
        renfo_a_faire = list(plan_semaine.get("renfo", []))
        course_a_faire = list(plan_semaine.get("course", []))
        if not avant_debut:
            for f in plan_fait.get(semaine, []):
                a_faire.remove(f)
            for f in renfo_faits.get(semaine, []):
                renfo_a_faire.remove(f)
            for f in course_faites.get(semaine, []):
                course_a_faire.remove(f)

    # --- Bilan : les 8 dernières semaines du plan, et la régularité
    bilan_semaines = []
    for n in range(max(1, semaine - 7), max(1, semaine) + 1):
        sn = [s for s in toutes if s["semaine"] == n]
        bilan_semaines.append({
            "numero": n, "debut": (lundi0 + datetime.timedelta(weeks=n - 1)).isoformat(),
            "rame_s": sum(s["temps_s"] for s in sn if not s["renfo"] and not s["course"]),
            "course_s": sum(s["temps_s"] for s in sn if s["course"]),
            "renfo_s": sum(s["temps_s"] for s in sn if s["renfo"] and s["termine"]),
            "rame_m": sum(s["distance_m"] for s in sn if not s["renfo"] and not s["course"]),
            "course_m": sum(s["distance_m"] for s in sn if s["course"]),
            "nb": len(sn)})
    jours_actifs = sorted({s["debut"].date() for s in toutes})
    # série de jours actifs : un seul jour de repos entre deux ne la casse pas
    serie_j, meilleure_j, prec = 0, 0, None
    for d in jours_actifs:
        serie_j = serie_j + 1 if prec is not None and (d - prec).days <= 2 else 1
        meilleure_j = max(meilleure_j, serie_j)
        prec = d
    if prec is None or (aujourd_hui - prec).days > 2:
        serie_j = 0

    # --- Records personnels (depuis le début de l'aventure)
    def record(candidats, plus_grand=False):
        best = None
        for valeur, s in candidats:
            if valeur is None:
                continue
            if best is None or (valeur > best["valeur"] if plus_grand else valeur < best["valeur"]):
                best = {"valeur": valeur, "date": s["debut"].isoformat(timespec="minutes"),
                        "programme": s["programme"]}
        return best
    rames = [s for s in toutes if not s["renfo"] and not s["course"]]
    records = {
        "rame_500": record((s["m500"], s) for s in rames),
        "rame_1000": record((s["m1000"], s) for s in rames),
        "rame_distance": record([(s["distance_m"] or None, s) for s in rames], True),
        "rame_watts": record([(s["watts_moyens"] if s["temps_s"] >= 300 else None, s) for s in rames], True),
        "course_1km": record((s["m1000"], s) for s in courses),
        "course_5km": record((s["m5000"], s) for s in courses),
        "course_distance": record([(s["distance_m"] or None, s) for s in courses], True),
        "course_allure": record(((s["temps_s"] / s["distance_m"] * 1000 if s["distance_m"] >= 2000 else None), s)
                                for s in courses),
    }

    return {
        "profil": P, "niveau": niveau, "xp_total": xp,
        "totaux": {"km": round(km, 2), "seances": len(liste), "renfo": len(renfos), "kcal": round(total_kcal),
                   "temps_s": sum(s["temps_s"] for s in liste),
                   "course_km": round(course_m / 1000, 2), "courses": len(courses),
                   "course_temps_s": sum(s["temps_s"] for s in courses)},
        "poids": {"depart": P["poids_depart_kg"], "objectif": P["poids_objectif_kg"], "actuel": poids_actuel,
                  "perdu": perdu, "a_perdre": a_perdre, "pesees": pes},
        "parcours": {"nom": R.get("parcours", {}).get("nom"), "km": round(km, 2), "escales": esc,
                     "derniere": atteintes[-1] if atteintes else None, "prochaine": prochaine,
                     "total_km": esc[-1]["km"] if esc else 0},
        "parcours_course": {"nom": R.get("parcours_course", {}).get("nom"), "km": round(km_c, 2), "escales": esc_c,
                            "derniere": atteintes_c[-1] if atteintes_c else None,
                            "prochaine": next((e for e in esc_c if e["km"] > km_c), None),
                            "total_km": esc_c[-1]["km"] if esc_c else 0},
        "badges": badges,
        "defis": {"mois": mois_courant, "liste": defis, "reussis": defis_reussis},
        "records": records,
        "bilan": {"semaines": bilan_semaines, "serie_jours": serie_j, "meilleure_serie_jours": meilleure_j,
                  "jours_actifs_semaine": len({s["debut"].date() for s in toutes if s["semaine"] == semaine})},
        "semaine": {"numero": semaine, "avant_debut": avant_debut, "debut": P["debut"], "renfo_a_faire": renfo_a_faire,
                    "course_a_faire": course_a_faire,
                    "renfo_plan": plan_semaine.get("renfo", []) if plan_semaine else [],
                    "course_plan": plan_semaine.get("course", []) if plan_semaine else [],
                    "theme": plan_semaine["theme"] if plan_semaine else "Plan terminé : continuez à votre rythme",
                    "nb_semaines": len(plan), "plan": plan_semaine["seances"] if plan_semaine else [],
                    "a_faire": a_faire, "km": round(km_semaine, 1), "nb_seances": len(ss)},
        "quetes": quetes, "recompenses": recompenses, "journal": journal,
    }


if __name__ == "__main__":
    print(json.dumps(etat(), ensure_ascii=False, indent=1, default=str)[:3000])
