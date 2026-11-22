// Mode Aventure : traduction de ../jeu.py (mêmes règles, même résultat).
// Tout est recalculé à partir des séances enregistrées et de donnees/.
import { stock } from "./stockage.js";

const PROFIL_DEFAUT = {
  prenom: "",
  taille_cm: 163,
  poids_depart_kg: 76.0,
  poids_objectif_kg: 70.0,
  debut: null,
  aventure_depuis: null,
  semainier: ["rame", "renfo", "rame", "repos", "rame", "course", "renfo"],
  remplacements: {},
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
  for (const k of ["prenom", "taille_cm", "poids_depart_kg", "poids_objectif_kg", "debut", "recompenses",
    "semainier", "remplacements"]) {
    if (k in maj) p[k] = maj[k];
  }
  await stock.ecrire("donnees/profil.json", p);
  return p;
}

/** Remet l'aventure à zéro (voir jeu.py, redemarrer). */
export async function redemarrer(debut, poidsDepart, poidsObjectif) {
  const p = await profil();
  debut = debut || dateIso(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) throw new Error("date invalide");
  p.debut = p.aventure_depuis = debut;
  p.remplacements = {};
  if (poidsDepart) p.poids_depart_kg = arrondi(Number(poidsDepart), 1);
  if (poidsObjectif) p.poids_objectif_kg = arrondi(Number(poidsObjectif), 1);
  await stock.ecrire("donnees/profil.json", p);
  return p;
}

/** Temps le plus court pour parcourir « longueur » mètres dans une suite de [temps, distance]. */
export function meilleurTemps(serie, longueur) {
  let meilleur = null, j = 0;
  for (let i = 0; i < serie.length; i++) {
    j = Math.max(j, i);
    while (j < serie.length && serie[j][1] - serie[i][1] < longueur) j++;
    if (j === serie.length) break;
    const dt = serie[j][0] - serie[i][0];
    if (meilleur === null || dt < meilleur) meilleur = dt;
  }
  return meilleur;
}
const dixieme = x => Math.floor(x * 10 + 0.5) / 10;

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

/** Course à pied (et marche rapide) : environ 1 kcal par kg et par km. */
export const kcalCourse = (distance, poids) => distance / 1000 * poids;

export function kcal(points, poids) {
  return points.reduce((s, p) => s + (0.048 * (p.watts || 0) + 1.19) * poids * 3.5 / 200 / 60, 0);
}

async function seances(poids, depuis) {
  const noms = {};
  for (const p of (programmes.programmes || [])) noms[p.nom] = p.id;
  const res = [];
  for (const nom of (await stock.lister("sessions")).sort()) {
    if (!nom.endsWith(".json")) continue;
    const d = await stock.lire("sessions/" + nom, null);
    if (!d || !("resume" in d)) continue;
    const r = d.resume;
    if (depuis && d.debut.slice(0, 10) < depuis) continue;
    const course = d.type === "course";
    let m500 = null, m1000 = null, m5000 = null;
    if (course) {
      const km = d.km || [];
      const trace = (d.trace || []).filter(p => p.length >= 5).map(p => [p[0], p[4]]);
      m1000 = km.length ? Math.min(...km.map((t, i) => t - (i ? km[i - 1] : 0))) : null;
      m5000 = meilleurTemps(trace, 5000);
    } else {
      const serie = (d.points || []).filter(p => p.distance_m != null).map(p => [p.t, p.distance_m]);
      m500 = meilleurTemps(serie, 500); m1000 = meilleurTemps(serie, 1000);
    }
    res.push({
      fichier: nom, debut: new Date(d.debut), programme: d.programme ?? null,
      programme_id: noms[d.programme], termine: Boolean(d.termine),
      precision: d.precision_cadence ?? null, renfo: d.type === "renfo", course,
      distance_m: r.distance_m || 0, temps_s: r.temps_s || 0,
      allure_moyenne_s: r.allure_moyenne_s ?? null, watts_moyens: r.watts_moyens ?? null, m500, m1000, m5000,
      kcal: course ? kcalCourse(r.distance_m || 0, poids) : kcal(d.points || [], poids),
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
  const depuis = P.aventure_depuis || null;
  let liste = await seances(poidsActuel, depuis);
  const lundi0 = jourLocal(P.debut);
  const semaineDe = d => Math.floor(jours(d, lundi0) / 7) + 1;
  const plan = (R.plan || {}).semaines || [];
  const rempl = P.remplacements || {};
  const planDe = n => {   // la semaine n du plan, avec les séances remplacées par l'utilisateur
    if (!(n > 0 && n <= plan.length)) return null;
    const res = { ...plan[n - 1] };
    for (const cle of ["seances", "renfo", "course"]) res[cle] = (plan[n - 1][cle] || []).map((x, i) => rempl[`${n}:${cle}:${i}`] || x);
    return res;
  };
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
  const planFait = new Map(), renfoFaits = new Map(), courseFaites = new Map();
  for (const [n, ss] of parSemaine) {
    const pn = planDe(n) || {};
    const attendues = [...(pn.seances || [])];
    const renfoAtt = [...(pn.renfo || [])];
    const courseAtt = [...(pn.course || [])];
    const faites = [];
    renfoFaits.set(n, []);
    courseFaites.set(n, []);
    for (const s of ss) {
      if (s.course) {
        let gain = Math.trunc(s.distance_m / 1000 * xr("par_km_course", 100));
        if (s.temps_s >= 600) gain += xr("seance_10min", 50);
        if (s.programme && s.termine) {
          gain += xr("seance_guidee_terminee", 100);
          if (retirer(courseAtt, s.programme_id)) {
            courseFaites.get(n).push(s.programme_id);
            gain += xr("seance_du_plan", 50);
          }
        }
        s.xp = gain;
        xp += gain;
        continue;
      }
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
    precision: s.precision, renfo: s.renfo, course: s.course, xp: s.xp,
  }));

  const toutes = liste;
  const renfos = liste.filter(s => s.renfo && s.termine);
  const courses = liste.filter(s => s.course);
  const rame = s => !s.renfo && !s.course;
  liste = liste.filter(rame);
  const rameSemaines = new Set([...parSemaine].filter(([, ss]) => ss.some(rame)).map(([n]) => n));
  const courseSemaine = new Map();
  for (const s of courses) {
    if (!courseSemaine.has(s.semaine)) courseSemaine.set(s.semaine, []);
    courseSemaine.get(s.semaine).push(s);
  }
  parSemaine = new Map([...parSemaine].map(([n, ss]) => [n, ss.filter(rame)]));
  const renfoSemaine = new Map();
  for (const s of renfos) {
    if (!renfoSemaine.has(s.semaine)) renfoSemaine.set(s.semaine, []);
    renfoSemaine.get(s.semaine).push(s);
  }
  const totalM = somme(liste, s => s.distance_m);
  const courseM = somme(courses, s => s.distance_m);
  const totalKcal = somme(liste, s => s.kcal) + somme(courses, s => s.kcal);
  const perdu = arrondi(P.poids_depart_kg - poidsActuel, 1);
  const aPerdre = arrondi(P.poids_depart_kg - P.poids_objectif_kg, 1);

  // --- Parcours
  const esc = (R.parcours || {}).escales || [];
  const km = totalM / 1000;
  const atteintes = esc.filter(e => e.km <= km);
  const prochaine = esc.find(e => e.km > km) || null;
  const escC = (R.parcours_course || {}).escales || [];
  const kmC = courseM / 1000;
  const atteintesC = escC.filter(e => e.km <= kmC);

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
    course1: courses.length >= 1, course5k: courses.some(s => s.distance_m >= 5000),
    course10: courses.length >= 10, course25: courseM >= 25000,
    duathlon: [...courseSemaine.keys()].some(n => rameSemaines.has(n)),
    sentier: escC.length > 0 && kmC >= escC[escC.length - 1].km,
  };

  // --- Défis du mois (mois civils depuis le début de l'aventure)
  const moisCourant = dateIso(aujourdhui).slice(0, 7);
  const parMois = new Map();
  for (const s of toutes) {
    const m = dateIso(s.debut).slice(0, 7);
    if (!parMois.has(m)) parMois.set(m, []);
    parMois.get(m).push(s);
  }
  const premierMois = [moisCourant, ...parMois.keys()].sort()[0];
  const estRame = s => !s.renfo && !s.course;
  const defisDuMois = m => {
    const ss = parMois.get(m) || [];
    const res = [];
    for (const d of (R.defis || [])) {
      let fait;
      if (d.id === "km_rame") fait = dixieme(somme(ss.filter(estRame), s => s.distance_m) / 1000);
      else if (d.id === "km_course") fait = dixieme(somme(ss.filter(s => s.course), s => s.distance_m) / 1000);
      else if (d.id === "seances") fait = compte(ss, s => (s.renfo && s.termine) || !s.renfo);
      else if (d.id === "cadence") fait = compte(ss, s => estRame(s) && (s.precision || 0) >= 80);
      else continue;
      res.push({ id: d.id, texte: d.texte.replaceAll("{but}", String(d.but)), fait, but: d.but, ok: fait >= d.but });
    }
    return res;
  };
  const defis = defisDuMois(moisCourant);
  let defisReussis = compte(defis, d => d.ok);
  let [an, mo] = premierMois.split("-").map(Number);
  while (`${an}-${p2(mo)}` < moisCourant) {
    defisReussis += compte(defisDuMois(`${an}-${p2(mo)}`), d => d.ok);
    if (mo === 12) { an++; mo = 1; } else mo++;
  }
  conditions.defi1 = defisReussis >= 1;
  conditions.defis5 = defisReussis >= 5;
  xp += defisReussis * xr("defi", 200);
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
  const planSemaine = avantDebut ? planDe(1) : planDe(semaine);
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
    } else if (q.id === "course" && planSemaine && (planSemaine.course || []).length) {
      fait = (courseFaites.get(semaine) || []).length; but = planSemaine.course.length;
    } else continue;
    quetes.push({ texte: q.texte.replaceAll("{km}", strPy(kmCible, brut < 20)), fait, but, ok: fait >= but });
  }
  // quêtes réussies des semaines passées (XP)
  for (let n = 1; n < semaine; n++) {
    const kmN = somme(parSemaine.get(n) || [], s => s.distance_m) / 1000;
    if (kmN >= Math.min(20, 3 + 1.2 * (n - 1))) xp += xr("quete", 150);
    if (n > 0 && n <= plan.length && (planFait.get(n) || []).length >= planDe(n).seances.length) xp += xr("quete", 150);
    if (n > 0 && n <= plan.length && (planDe(n).course || []).length &&
        (courseFaites.get(n) || []).length >= planDe(n).course.length) xp += xr("quete", 150);
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
    if (genre === "sentier") return atteintesC.some(e => e.nom === val);
    return false;
  };
  const recompenses = (P.recompenses || []).map(r => ({ ...r, obtenue: debloquee(r.condition) }));

  // --- Séances du plan restant à faire cette semaine
  let aFaire = [], renfoAFaire = [], courseAFaire = [];
  if (planSemaine) {
    aFaire = [...planSemaine.seances];
    renfoAFaire = [...(planSemaine.renfo || [])];
    courseAFaire = [...(planSemaine.course || [])];
    if (!avantDebut) {
      for (const f of (planFait.get(semaine) || [])) retirer(aFaire, f);
      for (const f of (renfoFaits.get(semaine) || [])) retirer(renfoAFaire, f);
      for (const f of (courseFaites.get(semaine) || [])) retirer(courseAFaire, f);
    }
  }

  // --- Bilan : les 8 dernières semaines du plan, et la régularité
  const bilanSemaines = [];
  for (let n = Math.max(1, semaine - 7); n <= Math.max(1, semaine); n++) {
    const ss = toutes.filter(s => s.semaine === n);
    bilanSemaines.push({
      numero: n, debut: dateIso(ajouterJours(lundi0, 7 * (n - 1))),
      rame_s: somme(ss.filter(estRame), s => s.temps_s),
      course_s: somme(ss.filter(s => s.course), s => s.temps_s),
      renfo_s: somme(ss.filter(s => s.renfo && s.termine), s => s.temps_s),
      rame_m: somme(ss.filter(estRame), s => s.distance_m),
      course_m: somme(ss.filter(s => s.course), s => s.distance_m),
      nb: ss.length });
  }
  const joursActifs = [...new Set(toutes.map(s => dateIso(s.debut)))].sort().map(jourLocal);
  let serieJ = 0, meilleureJ = 0, prec = null;
  for (const d of joursActifs) {
    serieJ = prec !== null && jours(d, prec) <= 2 ? serieJ + 1 : 1;
    meilleureJ = Math.max(meilleureJ, serieJ);
    prec = d;
  }
  if (prec === null || jours(aujourdhui, prec) > 2) serieJ = 0;

  // --- Records personnels (depuis le début de l'aventure)
  const meilleur = (candidats, plusGrand = false) => {
    let best = null;
    for (const [valeur, s] of candidats) {
      if (valeur === null || valeur === undefined) continue;
      if (best === null || (plusGrand ? valeur > best.valeur : valeur < best.valeur))
        best = { valeur, date: dateHeureIso(s.debut, false), programme: s.programme };
    }
    return best;
  };
  const rames = toutes.filter(estRame);
  const records = {
    rame_500: meilleur(rames.map(s => [s.m500, s])),
    rame_1000: meilleur(rames.map(s => [s.m1000, s])),
    rame_distance: meilleur(rames.map(s => [s.distance_m || null, s]), true),
    rame_watts: meilleur(rames.map(s => [s.temps_s >= 300 ? s.watts_moyens : null, s]), true),
    course_1km: meilleur(courses.map(s => [s.m1000, s])),
    course_5km: meilleur(courses.map(s => [s.m5000, s])),
    course_distance: meilleur(courses.map(s => [s.distance_m || null, s]), true),
    course_allure: meilleur(courses.map(s => [s.distance_m >= 2000 ? s.temps_s / s.distance_m * 1000 : null, s])),
  };

  return {
    profil: P, niveau, xp_total: xp,
    totaux: { km: arrondi(km, 2), seances: liste.length, renfo: renfos.length, kcal: Math.round(totalKcal),
      temps_s: somme(liste, s => s.temps_s),
      course_km: arrondi(courseM / 1000, 2), courses: courses.length, course_temps_s: somme(courses, s => s.temps_s) },
    poids: { depart: P.poids_depart_kg, objectif: P.poids_objectif_kg, actuel: poidsActuel,
      perdu, a_perdre: aPerdre, pesees: pes },
    parcours: { nom: (R.parcours || {}).nom ?? null, km: arrondi(km, 2), escales: esc,
      derniere: atteintes.length ? atteintes[atteintes.length - 1] : null, prochaine,
      total_km: esc.length ? esc[esc.length - 1].km : 0 },
    parcours_course: { nom: (R.parcours_course || {}).nom ?? null, km: arrondi(kmC, 2), escales: escC,
      derniere: atteintesC.length ? atteintesC[atteintesC.length - 1] : null,
      prochaine: escC.find(e => e.km > kmC) || null, total_km: escC.length ? escC[escC.length - 1].km : 0 },
    badges,
    defis: { mois: moisCourant, liste: defis, reussis: defisReussis },
    records,
    bilan: { semaines: bilanSemaines, serie_jours: serieJ, meilleure_serie_jours: meilleureJ,
      jours_actifs_semaine: new Set(toutes.filter(s => s.semaine === semaine).map(s => dateIso(s.debut))).size },
    semaine: { numero: semaine, avant_debut: avantDebut, debut: P.debut, renfo_a_faire: renfoAFaire,
      course_a_faire: courseAFaire,
      renfo_plan: planSemaine ? (planSemaine.renfo || []) : [], course_plan: planSemaine ? (planSemaine.course || []) : [],
      theme: planSemaine ? planSemaine.theme : "Plan terminé : continuez à votre rythme",
      nb_semaines: plan.length, plan: planSemaine ? planSemaine.seances : [],
      a_faire: aFaire, km: arrondi(kmSemaine, 1), nb_seances: ss.length },
    quetes, recompenses, journal,
  };
}
