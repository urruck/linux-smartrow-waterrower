// Remplace, dans le téléphone, le serveur Python (../rameur.py) :
// page.html reste identique à la version Linux et appelle toujours /flux,
// /historique, /nouvelle, /jeu… ; ces adresses sont servies ici, sans réseau.
//
// Chargé avant le script de page.html (voir construire_www.mjs).
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { BleClient } from "@capacitor-community/bluetooth-le";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import * as sr from "./smartrow.js";
import * as jeu from "./jeu.js";
import * as sauvegarde from "./sauvegarde.js";
import { stock } from "./stockage.js";

const CHAMPS = ["distance_m", "temps_s", "watts", "watts_moyens", "cadence", "coups",
  "allure_500m_s", "allure_moyenne_s", "travail_j", "longueur_coup", "arret"];
const attendre = ms => new Promise(r => setTimeout(r, ms));
const p2 = n => String(n).padStart(2, "0");
const nomFichier = d => `${jeu.dateIso(d)}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const NATIF = Capacitor.isNativePlatform();

// --- Séance en cours (classe Seance de rameur.py) --------------------------------

class Seance {
  constructor() {
    this.etat = { connexion: "recherche" };
    this.abonnes = new Set();
    this._courbe = [];
    this.nouvelle();
  }

  nouvelle() {
    this.debut = new Date();
    this.programme = null;
    this.termine = false;
    this.precision = null;
    this.points = [];
    this.coups = [];
    this._derniereSec = 0;
    this._modifiee = false;
    for (const k of CHAMPS) delete this.etat[k];
    this.etat.courbe = [];
    this.diffuser();
  }

  get fichier() { return "sessions/" + nomFichier(this.debut) + ".json"; }

  recu(horo, t, valeurs) {
    if (!t) return;
    if ("xyz".includes(t)) {
      if (t === "x") this._courbe = [];
      this._courbe = this._courbe.concat(valeurs.courbe);
      if (t === "z") {
        let courbe = this._courbe;
        while (courbe.length && courbe[courbe.length - 1] === 0) courbe = courbe.slice(0, -1);
        if (courbe.length) {
          this.etat.courbe = courbe;
          this.coups.push({ t: Math.round(horo * 10) / 10, courbe });
          this._modifiee = true;
        }
        this.diffuser();
      }
      return;
    }
    const dist = valeurs.distance_m;
    if (dist != null && dist < (this.etat.distance_m || 0) - 5) {
      this.sauver();      // le compteur est revenu à zéro : nouvelle séance
      this.nouvelle();
    }
    for (const [k, v] of Object.entries(valeurs)) if (v != null && CHAMPS.includes(k)) this.etat[k] = v;
    if ((this.etat.distance_m || 0) > 0 && Math.floor(horo) !== this._derniereSec && !this.etat.arret) {
      this._derniereSec = Math.floor(horo);
      const pt = { t: Math.floor(horo) };
      for (const k of CHAMPS) if (k !== "arret") pt[k] = this.etat[k] ?? null;
      this.points.push(pt);
      this._modifiee = true;
    }
    if (t === "a") this.diffuser();
  }

  diffuser() {
    const ev = { data: JSON.stringify(this.etat) };
    for (const f of this.abonnes) { try { f(ev); } catch (e) { console.error(e); } }
  }

  resume() {
    const r = {};
    for (const k of ["distance_m", "temps_s", "watts_moyens", "allure_moyenne_s", "coups"]) r[k] = this.etat[k] ?? null;
    return r;
  }

  sauver() {
    if (!this._modifiee || (this.etat.distance_m || 0) < 10) return Promise.resolve();
    this._modifiee = false;
    return stock.ecrire(this.fichier, {
      debut: jeu.dateHeureIso(this.debut), programme: this.programme, termine: this.termine,
      precision_cadence: this.precision, resume: this.resume(), points: this.points, coups: this.coups,
    });
  }
}

// --- Liaison Bluetooth avec le SmartRow (classes SmartRow et Capteur) ---------------

class Capteur {
  constructor(seance) {
    this.seance = seance;
    this.id = null;
    this.premiere = true;
    this.v3 = false;
    this._file = [];
  }

  statut(s) { this.seance.etat.connexion = s; this.seance.diffuser(); }

  ecrire(octets) { this._file.push(...octets); }

  async remiseAZero() { if (this.id) this.ecrire(sr.INIT); }

  _recu(vue) {
    const d = Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));
    if (sr.contient(d, "V3.")) {
      this.v3 = true;
      if (!this._defiDemande) { this._defiDemande = true; this.ecrire([35]); }  // « # »
    } else if (sr.contient(d, "KEYLOCK")) {
      this.v3 = true;
      this.ecrire(sr.reponseDefiV3(d));
    }
    const [t, v] = sr.decoder(d, this.v3);
    this.seance.recu(Date.now() / 1000, t, v);
  }

  async trouver(duree) {
    return new Promise(async fin => {
      let trouve = null;
      const arreter = async () => { try { await BleClient.stopLEScan(); } catch (e) { /* déjà arrêté */ } fin(trouve); };
      const minuterie = setTimeout(arreter, duree);
      try {
        await BleClient.requestLEScan({}, res => {
          const nom = (res.localName || (res.device && res.device.name) || "").toLowerCase();
          const uuids = (res.uuids || []).map(u => u.toLowerCase());
          if (!trouve && (nom.includes("smartrow") || uuids.includes(sr.SERVICE))) {
            trouve = res.device.deviceId;
            clearTimeout(minuterie);
            arreter();
          }
        });
      } catch (e) {
        console.warn("Recherche Bluetooth impossible", e);
        clearTimeout(minuterie);
        await attendre(3000);
        fin(null);
      }
    });
  }

  async lancer(id) {
    let perdu;
    const coupure = new Promise(r => { perdu = r; });
    this.v3 = false;
    this._defiDemande = false;
    this._file = [];
    await BleClient.connect(id, () => { console.log("SmartRow déconnecté."); perdu(); }, { timeout: 25000 });
    this.id = id;
    let actif = true;
    try {
      await BleClient.startNotifications(id, sr.SERVICE, sr.NOTIFICATION, v => this._recu(v));
      const ecrivain = (async () => {   // un octet à la fois, comme le fait l'appli d'origine
        while (actif) {
          if (this._file.length) {
            const b = this._file.shift();
            try { await BleClient.writeWithoutResponse(id, sr.SERVICE, sr.ECRITURE, new DataView(Uint8Array.of(b).buffer)); }
            catch (e) { console.warn("Écriture Bluetooth", e); }
            await attendre(30);
          } else await attendre(20);
        }
      })();
      const veille = setInterval(() => this.ecrire(sr.POLL), 1500);
      this.ecrire(sr.POLL);
      if (this.premiere) { await attendre(1000); this.ecrire(sr.INIT); }
      this.statut("ok");
      console.log("SmartRow connecté.");
      await coupure;
      clearInterval(veille);
      actif = false;
      await ecrivain;
    } finally {
      actif = false;
      this.id = null;
      try { await BleClient.disconnect(id); } catch (e) { /* déjà coupé */ }
    }
  }

  async boucle() {
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
    } catch (e) {
      this.statut("Bluetooth refusé : autorisez « Appareils à proximité » dans les réglages de l'application");
      return;
    }
    for (;;) {
      let actif = false;
      try { actif = await BleClient.isEnabled(); } catch (e) { /* inconnu */ }
      if (!actif) {
        this.statut("Bluetooth désactivé : activez-le pour trouver le SmartRow");
        try { await BleClient.requestEnable(); } catch (e) { /* refusé */ }
        await attendre(3000);
        continue;
      }
      this.statut("recherche");
      const id = await this.trouver(10000);
      if (!id) continue;
      this.statut("connexion");
      try {
        await this.lancer(id);
        this.premiere = false;
      } catch (e) {
        console.warn("Bluetooth : nouvelle tentative…", e);
      }
      await this.seance.sauver();
      await attendre(2000);
    }
  }
}

/** Rejoue exemples/seance-260m.log (démonstration dans un navigateur : ?demo ou ?demo=4). */
class Rejeu extends Capteur {
  constructor(seance, vitesse) { super(seance); this.vitesse = vitesse; }
  async remiseAZero() {}
  async boucle() {
    this.statut("ok");
    const lignes = (await (await stock.fichierAppli("exemples/seance-260m.log")).text())
      .split("\n").filter(l => l.trim()).map(l => l.split("\t"));
    if (!lignes.length) return;
    const decalage = Date.now() / 1000 - parseFloat(lignes[0][0]);
    let precedent = null;
    for (const [horo, hex] of lignes) {
      const h = parseFloat(horo);
      if (precedent !== null) await attendre((h - precedent) * 1000 / this.vitesse);
      precedent = h;
      const paquet = hex.trim().split(/\s+/).map(x => parseInt(x, 16));
      const [t, v] = sr.decoder(paquet);
      this.seance.recu(h + decalage, t, v);
    }
    console.log("Fin du rejeu.");
  }
}

// --- Voix : synthèse vocale d'Android ----------------------------------------------

async function parler(texte) {
  if (!texte.trim()) return;
  if (!NATIF) { console.log("Voix :", texte); return; }
  try {
    await TextToSpeech.stop();
    await TextToSpeech.speak({ text: texte, lang: "fr-FR", rate: 1.0, queueStrategy: 0 });
  } catch (e) { console.warn("Voix indisponible", e); }
}

// --- Les adresses de rameur.py ---------------------------------------------------

const seance = new Seance();
const demo = new URLSearchParams(location.search).get("demo");
const capteur = demo !== null || !NATIF ? new Rejeu(seance, parseFloat(demo) || 1) : new Capteur(seance);

async function historique() {
  const res = [];
  for (const nom of (await stock.lister("sessions")).sort().reverse()) {
    if (!nom.endsWith(".json")) continue;
    const d = await stock.lire("sessions/" + nom, null);
    if (!d || d.type === "renfo" || !d.resume || !d.debut) continue;
    res.push({ fichier: nom, debut: d.debut, programme: d.programme ?? null, ...d.resume });
  }
  return res;
}

const json = (obj = {}) => new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });

async function repondre(chemin, methode, p, corps) {
  const post = methode === "POST";
  if (chemin === "/historique") return json(await historique());
  if (chemin.startsWith("/seance/")) {
    const nom = decodeURIComponent(chemin.slice(8)).split("/").pop();
    return new Response(await stock.texte("sessions/" + nom), { headers: { "Content-Type": "application/json" } });
  }
  if (chemin === "/nouvelle" && post) {
    await seance.sauver();
    await capteur.remiseAZero();
    seance.nouvelle();
    seance.programme = p.get("programme");
    return json();
  }
  if (chemin === "/fin" && post) {
    seance.termine = true;
    const pc = p.get("precision") || "";
    seance.precision = /^\d+$/.test(pc) ? parseInt(pc, 10) : null;
    seance._modifiee = true;
    await seance.sauver();
    return json();
  }
  if (chemin === "/exercice" && post) {   // séance hors rameur terminée
    const maintenant = new Date();
    const duree = parseInt(p.get("duree") || "0", 10) || 0;
    await stock.ecrire("sessions/" + nomFichier(maintenant) + "_renfo.json", {
      debut: jeu.dateHeureIso(new Date(maintenant - duree * 1000)), type: "renfo",
      programme: p.get("programme") || "", termine: true,
      resume: { distance_m: 0, temps_s: duree }, points: [], coups: [],
    });
    return json();
  }
  if (chemin === "/parler" && post) { parler(String(corps || "").slice(0, 300)); return json(); }
  if (chemin === "/jeu") return json(await jeu.etat());
  if (chemin === "/profil" && post) { await jeu.enregistrerProfil(JSON.parse(corps || "{}")); return json(); }
  if (chemin === "/pesee" && post) { await jeu.ajouterPesee(parseFloat(p.get("kg").replace(",", "."))); return json(); }
  if (chemin === "/export" && post) return json(await sauvegarde.enregistrerExport());
  if (chemin === "/import" && post) {
    await seance.sauver();
    try { return json(await sauvegarde.fusionner(JSON.parse(corps || "{}"), p.get("profil") === "1")); }
    catch (e) { return json({ erreur: String(e.message || e), message: String(e.message || e) }); }
  }
  if (chemin === "/version") return json({ version: 3, plateforme: "android" });
  if (chemin === "/recettes") return stock.fichierAppli("recettes.json");
  if (chemin === "/programmes") return stock.fichierAppli("programmes.json");
  return null;
}

const ADRESSES = /^\/(historique|seance\/|nouvelle|fin|exercice|parler|jeu|profil|pesee|version|recettes|programmes|export|import)/;
const vraiFetch = window.fetch.bind(window);

window.fetch = async (entree, options = {}) => {
  const url = new URL(typeof entree === "string" ? entree : entree.url, location.href);
  if (url.origin !== location.origin || !ADRESSES.test(url.pathname)) return vraiFetch(entree, options);
  try {
    const r = await repondre(url.pathname, (options.method || "GET").toUpperCase(), url.searchParams, options.body);
    if (r) return r;
  } catch (e) {
    console.error("Erreur sur", url.pathname, e);
    return new Response("", { status: 500 });
  }
  return new Response("", { status: 404 });
};

// /flux : flux d'événements de la séance en direct, sans réseau
const VraiEventSource = window.EventSource;
class FluxLocal {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.onmessage = null;
    this.onerror = null;
    this.onopen = null;
    this._ecoutes = [];
    this._abonne = ev => {
      if (this.onmessage) this.onmessage(ev);
      for (const f of this._ecoutes) f(ev);
    };
    seance.abonnes.add(this._abonne);
    setTimeout(() => seance.diffuser(), 0);
  }
  addEventListener(type, f) { if (type === "message") this._ecoutes.push(f); }
  removeEventListener(type, f) { this._ecoutes = this._ecoutes.filter(g => g !== f); }
  close() { this.readyState = 2; seance.abonnes.delete(this._abonne); }
}
window.EventSource = function (url, opts) {
  return new URL(url, location.href).pathname === "/flux" ? new FluxLocal(url) : new VraiEventSource(url, opts);
};

// --- Démarrage ------------------------------------------------------------------

setInterval(() => seance.sauver(), 10000);
if (NATIF) {
  KeepAwake.keepAwake().catch(() => {});        // l'écran reste allumé pendant la séance
  App.addListener("pause", () => seance.sauver());
}
capteur.boucle().catch(e => { console.error(e); capteur.statut("Erreur : " + (e.message || e)); });
