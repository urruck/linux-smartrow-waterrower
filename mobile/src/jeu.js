// Mode Aventure : traduction de ../jeu.py (mêmes règles, même résultat).
// Tout est recalculé à partir des séances enregistrées et de donnees/.
import { stock } from "./stockage.js";

const PROFIL_DEFAUT = {
  prenom: "",
  taille_cm: 163,
  poids_depart_kg: 76.0,
  poids_objectif_kg: 70.0,
  debut: null,
  recompenses: [
    { condition: "poids:-2", texte: "À définir : une petite récompense (ciné, livre…)" },
    { condition: "escale:Chalonnes-sur-Loire", texte: "À définir" },
    { condition: "niveau:5", texte: "À définir : un équipement de sport ?" },
    { condition: "poids:-4", texte: "À définir" },
    { condition: "poids:objectif", texte: "À définir : la grosse récompense !" },
  ],
};

// round() de Python : arrondi de la valeur exacte (toFixed fait de même, Math.round non)
const arrondi = (x, n = 0) => Number(x.toFixed(n));
const p2 = n => String(n).padStart(2, "0");
export const dateIso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const dateHeureIso = (d, secondes = true) =>
  `${dateIso(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}` + (secondes ? `:${p2(d.getSeconds())}` : "");
const jourLocal = iso => { const [a, m, j] = iso.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, j); };
// nombre de jours entre deux dates (sans les heures, insensible à l'heure d'été)
const jours = (a, b) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
  Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
const ajouterJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// str() de Python pour un nombre arrondi : 3.0 reste « 3.0 », 20 (entier) reste « 20 »
const strPy = (x, flottant) => (flottant && Number.isInteger(x) ? x.toFixed(1) : String(x));

let regles = null, programmes = null;
async function statique(nom) {
  try { return await (await stock.fichierAppli(nom)).json(); } catch (e) { return {}; }
}

export async function profil() {
  const p = { ...PROFIL_DEFAUT, ...(await stock.lire("donnees/profil.json", {})) };
  if (!p.debut) {
    p.debut = dateIso(new Date());
    await stock.ecrire("donnees/profil.json", p);
  }
  return p;
}

export async function enregistrerProfil(maj) {
  const p = await profil();
  for (const k of ["prenom", "taille_cm", "poids_depart_kg", "poids_objectif_kg", "debut", "recompenses"]) {
    if (k in maj) p[k] = maj[k];
  }
  await stock.ecrire("donnees/profil.json", p);
  return p;
}

export async function pesees() {
  return [...(await stock.lire("donnees/pesees.json", []))].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function ajouterPesee(kg, date) {
  date = date || dateIso(new Date());
  const liste = (await pesees()).filter(x => x.date !== date);
  liste.push({ date, kg: arrondi(Number(kg), 1) });
  liste.sort((a, b) => (a.date < b.date ? -1 : 1));
  await stock.ecrire("donnees/pesees.json", liste);
}

export function kcal(points, poids) {
  return points.reduce((s, p) => s + (0.048 * (p.watts || 0) + 1.19) * poids * 3.5 / 200 / 60, 0);
}

async function seances(poids) {
  const noms = {};
  for (const p of (programmes.programmes || [])) noms[p.nom] = p.id;
  const res = [];
  for (const nom of (await stock.lister("sessions")).sort()) {
    if (!nom.endsWith(".json")) continue;
    const d = await stock.lire("sessions/" + nom, null);
    if (!d || !("resume" in d)) continue;
    const r = d.resume;
    res.push({
      fichier: nom, debut: new Date(d.debut), programme: d.programme ?? null,
      programme_id: noms[d.programme], termine: Boolean(d.termine),
      precision: d.precision_cadence ?? null, renfo: d.type === "renfo",
      distance_m: r.distance_m || 0, temps_s: r.temps_s || 0,
      allure_moyenne_s: r.allure_moyenne_s ?? null, kcal: kcal(d.points || [], poids),
    });
  }
  return res;
}

const xpNiveau = n => Math.floor(500 * n * (n - 1) / 2);
const retirer = (liste, x) => { const i = liste.indexOf(x); if (i >= 0) liste.splice(i, 1); return i >= 0; };
const somme = (l, f) => l.reduce((s, x) => s + f(x), 0);
const compte = (l, f) => l.filter(f).length;

/** Tout l'état du jeu, prêt à afficher (même structure que jeu.etat() en Python). */
export async function etat() {
  regles = regles || await statique("jeu.json");
  programmes = programmes || await statique("programmes.json");
  const R = regles, P = await profil();
  const xpR = R.xp || {};
  const xr = (k, d) => (k in xpR ? xpR[k] : d);
  const pes = await pesees();
  const poidsActuel = pes.length ? pes[pes.length - 1].kg : P.poids_depart_kg;
  let liste = await seances(poidsActuel);
  const lundi0 = jourLocal(P.debut);
  const semaineDe = d => Math.floor(jours(d, lundi0) / 7) + 1;
  const plan = (R.plan || {}).semaines || [];
  const aujourdhui = new Date();
  const semaine = Math.floor(jours(aujourdhui, lundi0) / 7) + 1;

  // --- XP par séance, plan par semaine
  let xp = 0;
  let parSemaine = new Map();
  for (const s of liste) {
    const n = semaineDe(s.debut);
    s.semaine = n;
    if (!parSemaine.has(n)) parSemaine.set(n, []);
    parSemaine.get(n).push(s);
  }
  const planFait = new Map(), renfoFaits = new Map();
  for (const [n, ss] of parSemaine) {
    const dansPlan = n > 0 && n <= plan.length;
    const attendues = dansPlan ? [...plan[n - 1].seances] : [];
    const renfoAtt = dansPlan ? [...(plan[n - 1].renfo || [])] : [];
    const faites = [];
    renfoFaits.set(n, []);
    for (const s of ss) {
      if (s.renfo) {
        s.xp = s.termine ? xr("seance_renfo", 80) : 0;
        if (retirer(renfoAtt, s.programme_id)) renfoFaits.get(n).push(s.programme_id);
        xp += s.xp;
        continue;
      }
      let gain = Math.trunc(s.distance_m / 100 * xr("par_100m", 10));
      if (s.temps_s >= 600) gain += xr("seance_10min", 50);
      if (s.programme && s.termine) {
        gain += xr("seance_guidee_terminee", 100);
        if (retirer(attendues, s.programme_id)) {
          faites.push(s.programme_id);
          gain += xr("seance_du_plan", 50);
        }
      }
      if (s.termine && s.precision !== null) gain += Math.round(s.precision / 100 * xr("precision_cadence_max", 100));
      s.xp = gain;
      xp += gain;
    }
    planFait.set(n, faites);
  }
  const journal = liste.slice(-15).reverse().map(s => ({
    date: dateHeureIso(s.debut, false), programme: s.programme || "Séance libre",
    distance_m: s.distance_m, temps_s: s.temps_s, kcal: Math.round(s.kcal),
    precision: s.precision, renfo: s.renfo, xp: s.xp,
  }));

  const renfos = liste.filter(s => s.renfo && s.termine);
  liste = liste.filter(s => !s.renfo);
  parSemaine = new Map([...parSemaine].map(([n, ss]) => [n, ss.filter(s => !s.renfo)]));
  const renfoSemaine = new Map();
  for (const s of renfos) {
    if (!renfoSemaine.has(s.semaine)) renfoSemaine.set(s.semaine, []);
    renfoSemaine.get(s.semaine).push(s);
  }
  const totalM = somme(liste, s => s.distance_m);
  const totalKcal = somme(liste, s => s.kcal);
  const perdu = arrondi(P.poids_depart_kg - poidsActuel, 1);
  const aPerdre = arrondi(P.poids_depart_kg - P.poids_objectif_kg, 1);

  // --- Parcours
  const esc = (R.parcours || {}).escales || [];
  const km = totalM / 1000;
  const atteintes = esc.filter(e => e.km <= km);
  const prochaine = esc.find(e => e.km > km) || null;

  // --- Semaines complètes (3 séances)
  const complete = n => (parSemaine.get(n) || []).length >= 3;
  let serie = 0, meilleureSerie = 0;
  const maxSemaine = parSemaine.size ? Math.max(...parSemaine.keys()) : 0;
  for (let n = 1; n <= maxSemaine; n++) {
    serie = complete(n) ? serie + 1 : 0;
    meilleureSerie = Math.max(meilleureSerie, serie);
  }

  const tests = liste.filter(s => s.programme_id === "test1000" && s.termine && s.allure_moyenne_s);
  const record = tests.length >= 2 && Math.min(...tests.slice(1).map(t => t.allure_moyenne_s)) < tests[0].allure_moyenne_s;
  const ventre = s => s.programme_id === "ventre1" || s.programme_id === "ventre2";

  const conditions = {
    premiere: liste.length >= 1, km1: km >= 1, km10: km >= 10, km42: km >= 42.195, km100: km >= 100,
    seance5k: liste.some(s => s.distance_m >= 5000),
    seance30: liste.some(s => s.temps_s >= 1800),
    semaine3: [...parSemaine.keys()].some(complete), serie4: meilleureSerie >= 4,
    matinal: liste.some(s => s.debut.getHours() < 8),
    guide5: compte(liste, s => s.programme && s.termine) >= 5,
    reprise: (planFait.get(1) || []).length >= 3 && (planFait.get(2) || []).length >= 3,
    fractionne: liste.some(s => s.termine && ["fractionne3030", "pyramide"].includes(s.programme_id)),
    metronome: liste.some(s => (s.precision || 0) >= 80),
    horloger: compte(liste, s => (s.precision || 0) >= 80) >= 5,
    gaine: compte(renfos, ventre) >= 5,
    gaine20: compte(renfos, ventre) >= 20,
    cheville6: compte(renfos, s => s.programme_id === "cheville") >= 6,
    record1000: record, kcal1000: totalKcal >= 1000, kcal5000: totalKcal >= 5000,
    poids1: perdu >= 1, poids3: perdu >= 3, poids_obj: pes.length > 0 && poidsActuel <= P.poids_objectif_kg,
    chalonnes: km >= 68, nantes: km >= 135, ocean: km >= 190,
  };
  const badges = (R.badges || []).map(b => ({ ...b, obtenu: Boolean(conditions[b.id]) }));
  xp += compte(badges, b => b.obtenu) * xr("badge", 100);

  // --- Quêtes de la semaine en cours
  const brut = 3 + 1.2 * (semaine - 1);
  const kmCible = brut < 20 ? arrondi(brut, 1) : 20;
  const ss = parSemaine.get(semaine) || [];
  const kmSemaine = somme(ss, s => s.distance_m) / 1000;
  const lundi = ajouterJours(lundi0, 7 * (semaine - 1));
  const debutS = dateIso(lundi), finS = dateIso(ajouterJours(lundi, 7));
  const peseeSemaine = pes.some(p => debutS <= p.date && p.date < finS);
  const avantDebut = semaine < 1;
  const planSemaine = avantDebut && plan.length ? plan[0] : (semaine > 0 && semaine <= plan.length ? plan[semaine - 1] : null);
  let quetes = [];
  for (const q of (R.quetes || [])) {
    let fait, but;
    if (q.id === "plan" && planSemaine) {
      fait = (planFait.get(semaine) || []).length; but = planSemaine.seances.length;
    } else if (q.id === "km") {
      fait = arrondi(kmSemaine, 1); but = kmCible;
    } else if (q.id === "renfo") {
      fait = (renfoSemaine.get(semaine) || []).length; but = 2;
    } else if (q.id === "cadence") {
      fait = compte(ss, s => (s.precision || 0) >= 75); but = 2;
    } else if (q.id === "pesee") {
      fait = peseeSemaine ? 1 : 0; but = 1;
    } else continue;
    quetes.push({ texte: q.texte.replaceAll("{km}", strPy(kmCible, brut < 20)), fait, but, ok: fait >= but });
  }
  // quêtes réussies des semaines passées (XP)
  for (let n = 1; n < semaine; n++) {
    const kmN = somme(parSemaine.get(n) || [], s => s.distance_m) / 1000;
    if (kmN >= Math.min(20, 3 + 1.2 * (n - 1))) xp += xr("quete", 150);
    if (n > 0 && n <= plan.length && (planFait.get(n) || []).length >= plan[n - 1].seances.length) xp += xr("quete", 150);
  }
  if (avantDebut) quetes = [];
  xp += somme(quetes.filter(q => q.ok && !q.texte.includes("pesee")), () => xr("quete", 150));

  // --- Niveau
  const noms = R.niveaux || ["Niveau"];
  let n = 1;
  while (xpNiveau(n + 1) <= xp) n++;
  const niveau = { numero: n, nom: noms[Math.min(n, noms.length) - 1], xp,
    xp_debut: xpNiveau(n), xp_suivant: xpNiveau(n + 1) };

  // --- Récompenses personnelles
  const debloquee = cond => {
    const i = cond.indexOf(":");
    const genre = i < 0 ? cond : cond.slice(0, i), val = i < 0 ? "" : cond.slice(i + 1);
    if (genre === "poids") return val === "objectif" ? conditions.poids_obj : perdu >= Math.abs(parseFloat(val));
    if (genre === "escale") return atteintes.some(e => e.nom === val);
    if (genre === "niveau") return n >= parseInt(val, 10);
    if (genre === "km") return km >= parseFloat(val);
    return false;
  };
  const recompenses = (P.recompenses || []).map(r => ({ ...r, obtenue: debloquee(r.condition) }));

  // --- Séances du plan restant à faire cette semaine
  let aFaire = [], renfoAFaire = [];
  if (planSemaine) {
    aFaire = [...planSemaine.seances];
    renfoAFaire = [...(planSemaine.renfo || [])];
    if (!avantDebut) {
      for (const f of (planFait.get(semaine) || [])) retirer(aFaire, f);
      for (const f of (renfoFaits.get(semaine) || [])) retirer(renfoAFaire, f);
    }
  }

  return {
    profil: P, niveau, xp_total: xp,
    totaux: { km: arrondi(km, 2), seances: liste.length, renfo: renfos.length, kcal: Math.round(totalKcal),
      temps_s: somme(liste, s => s.temps_s) },
    poids: { depart: P.poids_depart_kg, objectif: P.poids_objectif_kg, actuel: poidsActuel,
      perdu, a_perdre: aPerdre, pesees: pes },
    parcours: { nom: (R.parcours || {}).nom ?? null, km: arrondi(km, 2), escales: esc,
      derniere: atteintes.length ? atteintes[atteintes.length - 1] : null, prochaine,
      total_km: esc.length ? esc[esc.length - 1].km : 0 },
    badges,
    semaine: { numero: semaine, avant_debut: avantDebut, debut: P.debut, renfo_a_faire: renfoAFaire,
      theme: planSemaine ? planSemaine.theme : "Plan terminé : continuez à votre rythme",
      nb_semaines: plan.length, plan: planSemaine ? planSemaine.seances : [],
      a_faire: aFaire, km: arrondi(kmSemaine, 1), nb_seances: ss.length },
    quetes, recompenses, journal,
  };
}
