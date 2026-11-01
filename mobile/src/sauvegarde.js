// Sauvegarde et transfert : traduction de ../sauvegarde.py (même format de fichier).
// Export : le fichier est enregistré dans Documents puis proposé au partage
// (Nextcloud, courriel, Drive, Quick Share…). Import : sans rien effacer.
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { stock } from "./stockage.js";
import { dateHeureIso, dateIso } from "./jeu.js";

const FORMAT = "rameur-smartrow";
const NOM_VALIDE = /^[0-9A-Za-z_-]+\.json$/;

export async function exporter() {
  const sessions = {};
  for (const nom of (await stock.lister("sessions")).sort()) {
    if (!NOM_VALIDE.test(nom)) continue;
    const d = await stock.lire("sessions/" + nom, null);
    if (d !== null) sessions[nom] = d;
  }
  const donnees = {};
  for (const nom of ["profil.json", "pesees.json"]) {
    const d = await stock.lire("donnees/" + nom, null);
    if (d !== null) donnees[nom] = d;
  }
  return { format: FORMAT, version: 1, appareil: Capacitor.getPlatform(),
    cree: dateHeureIso(new Date()), sessions, donnees };
}

/** Écrit la sauvegarde et ouvre le menu de partage d'Android. */
export async function enregistrerExport() {
  const d = await exporter();
  const nb = Object.keys(d.sessions).length;
  const nom = `rameur-sauvegarde-${dateIso(new Date())}.json`;
  const data = JSON.stringify(d);
  if (!Capacitor.isNativePlatform()) {   // navigateur (démo) : téléchargement classique
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = nom;
    a.click();
    return { seances: nb, message: `Sauvegarde téléchargée (${nb} séances) : ${nom}` };
  }
  let uri, lieu;
  try {
    uri = (await Filesystem.writeFile({ path: nom, data, directory: Directory.Documents, encoding: Encoding.UTF8 })).uri;
    lieu = `Documents/${nom}`;
  } catch (e) {   // Documents inaccessible : fichier temporaire, à partager
    uri = (await Filesystem.writeFile({ path: nom, data, directory: Directory.Cache, encoding: Encoding.UTF8 })).uri;
    lieu = null;
  }
  try {
    await Share.share({ title: "Sauvegarde du rameur", text: `Sauvegarde du rameur (${nb} séances)`, files: [uri],
      dialogTitle: "Envoyer la sauvegarde vers…" });
  } catch (e) { /* partage annulé */ }
  return { seances: nb, message: `Sauvegarde faite (${nb} séances)` + (lieu ? ` : ${lieu}` : "") + "." };
}

export async function fusionner(d, remplacerProfil = false) {
  if (!d || typeof d !== "object" || d.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde du rameur.");
  const existantes = new Set(await stock.lister("sessions"));
  let ajoutees = 0, presentes = 0;
  for (const [nom, contenu] of Object.entries(d.sessions || {})) {
    if (!NOM_VALIDE.test(nom) || !contenu || typeof contenu !== "object" || Array.isArray(contenu)) continue;
    if (existantes.has(nom)) presentes++;
    else { await stock.ecrire("sessions/" + nom, contenu); ajoutees++; }
  }
  const donnees = d.donnees || {};
  const pes = await stock.lire("donnees/pesees.json", []);
  const dates = new Set(pes.map(p => p.date));
  const nouvelles = (Array.isArray(donnees["pesees.json"]) ? donnees["pesees.json"] : [])
    .filter(p => p && typeof p === "object" && "date" in p && "kg" in p && !dates.has(p.date));
  if (nouvelles.length) {
    await stock.ecrire("donnees/pesees.json", [...pes, ...nouvelles].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  }
  const p = donnees["profil.json"];
  const profil = Boolean(remplacerProfil && p && typeof p === "object" && !Array.isArray(p));
  if (profil) await stock.ecrire("donnees/profil.json", p);
  let message = `${ajoutees} séance(s) ajoutée(s), ${presentes} déjà présente(s), ${nouvelles.length} pesée(s) ajoutée(s)`;
  if (profil) message += ", profil remplacé";
  return { seances_ajoutees: ajoutees, seances_presentes: presentes, pesees_ajoutees: nouvelles.length, profil,
    message: message + "." };
}
