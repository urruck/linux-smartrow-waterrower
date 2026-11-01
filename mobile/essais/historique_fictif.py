#!/usr/bin/env python3
"""Fabrique un historique fictif (séances, renfo, pesées) dans le dossier donné,
pour comparer les versions Python et JavaScript de l'aventure sur tous les cas."""
import datetime, json, os, random, sys
d = sys.argv[1]; graine = int(sys.argv[2]) if len(sys.argv) > 2 else 1
random.seed(graine)
os.makedirs(f"{d}/sessions", exist_ok=True); os.makedirs(f"{d}/donnees", exist_ok=True)
progs = json.load(open(os.path.join(os.path.dirname(__file__), "../../programmes.json")))["programmes"]
debut = datetime.date.today() - datetime.timedelta(days=random.randint(-3, 100))
json.dump({"prenom": "Essai", "debut": debut.isoformat(), "poids_depart_kg": 80.0, "poids_objectif_kg": 74.0,
           "recompenses": [{"condition": c, "texte": c} for c in
                           ("poids:-2", "escale:Gennes", "niveau:3", "km:20", "poids:objectif", "autre:1")]},
          open(f"{d}/donnees/profil.json", "w"))
json.dump([{"date": (debut + datetime.timedelta(days=7 * i + random.randint(0, 6))).isoformat(),
            "kg": round(80 - i * random.uniform(0, 0.8), 1)} for i in range(random.randint(0, 14))],
          open(f"{d}/donnees/pesees.json", "w"))
t = datetime.datetime.combine(debut - datetime.timedelta(days=5), datetime.time(6, 30))
for i in range(random.randint(5, 70)):
    t += datetime.timedelta(hours=random.randint(5, 60), minutes=random.randint(0, 59))
    p = random.choice(progs + [None] * 3)
    renfo = p is not None and random.random() < 0.3
    dist = 0 if renfo else random.randint(0, 7000)
    duree = random.randint(60, 2400)
    points = [{"t": k, "watts": random.randint(0, 200)} for k in range(0, duree, 7)]
    s = {"debut": t.isoformat(timespec="seconds"), "programme": p["nom"] if p else None,
         "termine": random.random() < 0.7, "precision_cadence": random.choice([None, random.randint(30, 100)]),
         "resume": {"distance_m": dist, "temps_s": duree, "allure_moyenne_s": random.choice([None, random.randint(110, 200)])},
         "points": [] if renfo else points, "coups": []}
    if renfo:
        s["type"] = "renfo"
    json.dump(s, open(f"{d}/sessions/{t:%Y-%m-%d_%H%M%S}{'_renfo' if renfo else ''}.json", "w"))
