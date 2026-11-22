// Course à pied : adresses /course/… et /courses de la page.
// Sur le téléphone, tout le travail (GPS, voix, enregistrement) est fait par
// le service Android ServiceCourse, qui continue écran éteint. Dans un
// navigateur (démonstration, essais), une sortie simulée le remplace.
import { Capacitor, CourseGps } from "./capacitor.js";
import { stock } from "./stockage.js";
import { dateHeureIso, dateIso } from "./jeu.js";

const NATIF = Capacitor.isNativePlatform();

/** Sorties enregistrées, de la plus récente à la plus ancienne. */
export async function historique() {
  const res = [];
  for (const nom of (await stock.lister("sessions")).sort().reverse()) {
    if (!nom.endsWith("_course.json")) continue;
    const d = await stock.lire("sessions/" + nom, null);
    if (!d || d.type !== "course" || !d.resume || !d.debut) continue;
    res.push({ fichier: nom, debut: d.debut, programme: d.programme ?? null, termine: Boolean(d.termine),
      en_cours: Boolean(d.en_cours), km: d.km || [], ...d.resume });
  }
  return res;
}

// --- Sortie simulée (navigateur) ------------------------------------------------

const VITESSES = { marche: 1.6, footing: 2.6, course: 2.9, vite: 3.4 };   // m/s
const p2 = n => String(n).padStart(2, "0");

class Simulation {
  constructor(acceleration) { this.v = acceleration; this.s = null; }

  async demarrer(o) {
    if (this.s) return this.etat();
    this.s = { o, etapes: o.etapes || [], enreg: false, pause: false, t: 0, d: 0, etape: -1, et0: 0, ed0: 0,
      termine: false, km: [], trace: [], debut: null, fichier: null, precision: 40 };
    console.log("Voix :", o.intro || "Recherche du signal GPS.");
    setTimeout(() => { if (this.s) { this.s.precision = 6; this._commencer("Signal GPS trouvé. "); } }, 2500);
    this._tic = setInterval(() => this._avancer(0.25 * this.v), 250);
    return {};
  }

  _commencer(prefixe) {
    const s = this.s;
    if (s.enreg) return;
    s.enreg = true;
    s.debut = new Date();
    s.fichier = `${dateIso(s.debut)}_${p2(s.debut.getHours())}${p2(s.debut.getMinutes())}${p2(s.debut.getSeconds())}_course.json`;
    if (s.etapes.length) { s.etape = 0; console.log("Voix :", prefixe + "C'est parti. " + s.etapes[0].texte); }
    else console.log("Voix :", prefixe + "C'est parti, bonne sortie !");
  }

  _avancer(dt) {
    const s = this.s;
    if (!s || !s.enreg || s.pause) return;
    const e = s.etapes[s.etape];
    const vit = (VITESSES[e && e.zone] || 2.6) * (0.92 + 0.16 * Math.random());
    for (let k = 0; k < dt; k += 1) {
      const pas = Math.min(1, dt - k);
      s.t += pas; s.d += vit * pas;
      const a = s.d / 400, lat = 47.2185 + 0.0018 * Math.sin(a), lon = -0.7905 + 0.0026 * Math.cos(a) - 0.0026;
      s.trace.push([Math.round(s.t * 10) / 10, +lat.toFixed(6), +lon.toFixed(6), 60, Math.round(s.d * 10) / 10]);
      while (s.d >= (s.km.length + 1) * 1000) { s.km.push(Math.round(s.t)); console.log("Voix :", `${s.km.length} kilomètre(s)`); }
      if (!s.termine && s.etape >= 0 && s.etape < s.etapes.length) {
        const et = s.etapes[s.etape];
        const reste = et.duree_s ? et.duree_s - (s.t - s.et0) : et.distance_m - (s.d - s.ed0);
        if (reste <= 0) {
          s.etape++; s.et0 = s.t; s.ed0 = s.d;
          if (s.etape >= s.etapes.length) { s.termine = true; console.log("Voix : Séance terminée, bravo !"); }
          else console.log("Voix :", s.etapes[s.etape].texte);
        }
      }
    }
  }

  etat() {
    const s = this.s;
    if (!s) return { actif: false, gps_active: true, autorise: true };
    const o = { actif: true, enregistrement: s.enreg, pause: s.pause, programme: s.o.programme ?? null,
      temps_s: Math.round(s.t * 10) / 10, distance_m: Math.round(s.d * 10) / 10,
      allure_km_s: s.d > 50 ? Math.round(s.t / s.d * 1000) : null, allure_inst_km_s: null,
      precision_m: s.precision, gps_age_s: 0, etape: s.etape, nb_etapes: s.etapes.length, termine: s.termine,
      km: s.km, nb_points: s.trace.length, debut: s.debut ? dateHeureIso(s.debut) : null,
      gps_active: true, autorise: true };
    const p = s.trace.findLast(x => s.t - x[0] >= 30);
    if (p && s.d - p[4] > 20) o.allure_inst_km_s = Math.round((s.t - p[0]) / (s.d - p[4]) * 1000);
    const e = s.etapes[s.etape];
    if (e) {
      if (e.duree_s) Object.assign(o, { etape_reste: Math.max(0, e.duree_s - (s.t - s.et0)), etape_unite: "s", etape_fait: Math.min(1, (s.t - s.et0) / e.duree_s) });
      else Object.assign(o, { etape_reste: Math.max(0, e.distance_m - (s.d - s.ed0)), etape_unite: "m", etape_fait: Math.min(1, (s.d - s.ed0) / e.distance_m) });
    }
    return o;
  }

  trace({ depuis = 0 } = {}) { return { points: this.s ? this.s.trace.slice(depuis) : [] }; }
  pause() { if (this.s && this.s.enreg) this.s.pause = true; return this.etat(); }
  reprendre() { if (this.s) this.s.pause = false; return this.etat(); }
  forcer() { if (this.s) this._commencer(""); return this.etat(); }
  suivante() {
    const s = this.s;
    if (s && !s.termine && s.etape >= 0) { s.et0 = s.t - (s.etapes[s.etape].duree_s || 0); s.ed0 = s.d - (s.etapes[s.etape].distance_m || 0); this._avancer(0.01); }
    return this.etat();
  }
  voix() { return {}; }
  reglagesGps() { return {}; }

  async arreter({ garder = true } = {}) {
    const s = this.s;
    if (!s) return this.etat();
    clearInterval(this._tic);
    const r = this.etat();
    r.fichier = null;
    if (garder && s.enreg && (s.d >= 50 || s.t >= 60)) {
      await stock.ecrire("sessions/" + s.fichier, {
        debut: dateHeureIso(s.debut), type: "course", programme: s.o.programme ?? null,
        termine: s.etapes.length ? s.termine : true,
        resume: { distance_m: Math.round(s.d * 10) / 10, temps_s: Math.round(s.t), allure_km_s: s.d > 50 ? Math.round(s.t / s.d * 1000) : null,
          duree_totale_s: Math.round(s.t) },
        km: s.km, trace: s.trace, points: [], coups: [],
      });
      r.fichier = s.fichier;
    }
    this.s = null;
    return r;
  }
}

const demo = new URLSearchParams(location.search).get("demo");
const moteur = NATIF ? CourseGps : new Simulation(parseFloat(demo) || 1);

/** /course/<action> : etat, demarrer, pause, reprendre, forcer, suivante, voix, arreter, trace, reglages. */
export async function commande(action, p, corps) {
  try {
    switch (action) {
      case "etat": return await moteur.etat();
      case "demarrer": await moteur.demarrer(JSON.parse(corps || "{}")); return await moteur.etat();
      case "pause": return await moteur.pause();
      case "reprendre": return await moteur.reprendre();
      case "forcer": return await moteur.forcer();
      case "suivante": return await moteur.suivante();
      case "voix": await moteur.voix({ active: p.get("active") !== "0" }); return {};
      case "arreter": return await moteur.arreter({ garder: p.get("garder") !== "0" });
      case "trace": return await moteur.trace({ depuis: parseInt(p.get("depuis") || "0", 10) || 0 });
      case "reglages": await moteur.reglagesGps(); return {};
      default: return { erreur: "Commande inconnue : " + action };
    }
  } catch (e) {
    return { erreur: String((e && e.message) || e), code: (e && e.code) || null };
  }
}
