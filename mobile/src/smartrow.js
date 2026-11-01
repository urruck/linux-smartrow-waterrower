// Protocole Bluetooth du SmartRow : traduction de ../smartrow_ble.py
// (mêmes règles, mêmes noms de champs ; voir ce fichier pour les explications).

const uuid = court => `0000${court.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid(0x1234);
export const ECRITURE = uuid(0x1235);
export const NOTIFICATION = uuid(0x1236);

const octets = s => Array.from(s, c => c.charCodeAt(0));
export const INIT = octets("$\rV@\r");
export const POLL = octets("$");

const somme = tab => tab.reduce((a, b) => a + b, 0);
const hex = (n, l) => n.toString(16).toUpperCase().padStart(l, "0");
const texte = p => Array.from(p, b => (b < 128 ? String.fromCharCode(b) : "�")).join("");

export function contient(p, motif) {
  return texte(p).includes(motif);
}

function nettoyer(p) {  // bytes.strip() de Python
  const blanc = b => b === 32 || (b >= 9 && b <= 13);
  let d = 0, f = p.length;
  while (d < f && blanc(p[d])) d++;
  while (f > d && blanc(p[f - 1])) f--;
  return p.slice(d, f);
}

/** Réponse au défi « KEYLOCK=… » des SmartRow V3 (repris de QZ). */
export function reponseDefiV3(message) {
  let t = nettoyer(Array.from(message));
  const i = texte(t).indexOf("KEYLOCK=");
  if (i >= 0) t = t.slice(i);
  if (t.length < 16) return octets("#");
  const cle = t.slice(0, 14), s = texte(t.slice(14, 16)).toUpperCase();
  if (hex(somme(cle), 4).slice(-2) !== s) return octets("#");
  const g = texte(t.slice(10, 14)).trim();
  if (!/^[+-]?[0-9a-fA-F]+$/.test(g)) return octets("#");
  const rep = Math.floor(parseInt(g, 16) * 17923 / 256).toString(16).padStart(6, "0").slice(-4);
  return octets("\r" + rep + "\r");
}

function ent(t) {
  t = t.replaceAll(" ", "0");
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
}

function mmss(t) {  // « 312 » -> 192 s
  const m = ent(t.slice(0, -2)), s = ent(t.slice(-2));
  return m === null || s === null ? null : m * 60 + s;
}

export function checksumOk(p) {
  return p.length === 17 && hex(somme(p.slice(0, 14)) & 0xff, 2) === texte(p.slice(14, 16));
}

/** Décode un message de 17 octets. Renvoie [type, valeurs] ou [null, {}]. */
export function decoder(paquet, v3 = false) {
  if (paquet.length !== 17) return [null, {}];
  const p = Array.from(paquet);
  if (v3 && "abcdefxyz".includes(String.fromCharCode(p[0]))) {
    for (let i = 1; i < 6; i++) p[i] = (p[i] & 0x0f) | 0x30;
  }
  if (!v3 && !checksumOk(p)) return [null, {}];
  const s = texte(p), t = s[0];
  if (t === "f") {
    const dm = ent(s.slice(1, 7));
    return [t, { distance_m: dm !== null ? dm / 10 : null, valeur_f: ent(s.slice(7, 11)), arret: s[11] === "!" }];
  }
  const v = { distance_m: ent(s.slice(1, 6)) };
  if (t === "a") {
    v.temps_s = mmss(s.slice(6, 11));
  } else if (t === "b") {
    const tr = ent(s.slice(7, 11));
    v.travail_j = tr !== null ? tr / 10 : null;
    v.longueur_coup = ent(s.slice(11, 14));
  } else if (t === "c") {
    v.watts = ent(s.slice(6, 9));
    const moy = ent(s.slice(9, 14));
    v.watts_moyens = moy !== null ? moy / 10 : null;
  } else if (t === "d") {
    const cad = ent(s.slice(6, 9));
    v.cadence = cad !== null ? cad / 10 : null;
    v.coups = ent(s.slice(9, 13));
  } else if (t === "e") {
    v.allure_500m_s = mmss(s.slice(6, 9));
    v.allure_moyenne_s = mmss(s.slice(9, 12));
  } else if ("xyz".includes(t)) {
    v.courbe = p.slice(6, 14).map(c => c - 33);
  }
  return [t, v];
}
