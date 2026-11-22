#!/usr/bin/env python3
"""Fabrique un historique fictif (séances, renfo, course, pesées) dans le dossier donné,
pour comparer les versions Python et JavaScript de l'aventure sur tous les cas."""
import datetime, json, os, random, sys
d = sys.argv[1]; graine = int(sys.argv[2]) if len(sys.argv) > 2 else 1
random.seed(graine)
os.makedirs(f"{d}/sessions", exist_ok=True); os.makedirs(f"{d}/donnees", exist_ok=True)
progs = json.load(open(os.path.join(os.path.dirname(__file__), "../../programmes.json")))["programmes"]
debut = datetime.date.today() - datetime.timedelta(days=random.randint(-3, 100))
depuis = random.choice([None, (debut + datetime.timedelta(days=random.randint(-10, 20))).isoformat()])
ids = {k: [p["id"] for p in progs if f(p)] for k, f in
       (("seances", lambda p: not p.get("course") and not p.get("sans_rameur")),
        ("renfo", lambda p: p.get("sans_rameur")), ("course", lambda p: p.get("course")))}
rempl = {f"{random.randint(1, 12)}:{k}:{random.randint(0, 2)}": random.choice(ids[k])
         for k in random.choices(list(ids), k=random.randint(0, 8))}
json.dump({"prenom": "Essai", "debut": debut.isoformat(), "poids_depart_kg": 80.0, "poids_objectif_kg": 74.0,
           "aventure_depuis": depuis, "remplacements": rempl,
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
    course = (p is not None and p.get("course")) or (p is None and random.random() < 0.2)
    renfo = not course and p is not None and random.random() < 0.3
    dist = 0 if renfo else random.randint(0, 7000)
    duree = random.randint(60, 2400)
    pas = dist / max(1, duree // 7)
    points = [{"t": 1700000000 + k, "watts": random.randint(0, 200),
               "distance_m": round(i * pas * random.uniform(0.8, 1.2) + i * pas, 1) / 2}
              for i, k in enumerate(range(0, duree, 7))]
    s = {"debut": t.isoformat(timespec="seconds"), "programme": p["nom"] if p else None,
         "termine": random.random() < 0.7, "precision_cadence": random.choice([None, random.randint(30, 100)]),
         "resume": {"distance_m": dist, "temps_s": duree, "allure_moyenne_s": random.choice([None, random.randint(110, 200)])},
         "points": [] if renfo else points, "coups": []}
    if renfo:
        s["type"] = "renfo"
    if course:
        s["type"] = "course"
        s["points"] = []
        dc = random.randint(0, 9000) + random.random()
        s["resume"]["distance_m"] = dc
        n = max(2, duree // 3)
        s["trace"] = [[round(i * duree / n, 1), 47.2, -0.79, 60, round(dc * (i / n) ** random.uniform(0.9, 1.1), 1)]
                      for i in range(n + 1)]
        s["km"] = sorted(random.randint(1, duree) for _ in range(int(dc // 1000)))
    suffixe = "_renfo" if renfo else "_course" if course else ""
    json.dump(s, open(f"{d}/sessions/{t:%Y-%m-%d_%H%M%S}{suffixe}.json", "w"))
