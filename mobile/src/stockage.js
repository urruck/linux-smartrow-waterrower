// Données personnelles dans le stockage privé de l'application
// (même organisation que ~/.local/share/rameur-smartrow sur Linux :
// sessions/*.json et donnees/profil.json, donnees/pesees.json).
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

const vraiFetch = window.fetch.bind(window);
const D = { directory: Directory.Data };
let file = Promise.resolve();   // écritures l'une après l'autre

export const stock = {
  /** Fichier livré avec l'application (jeu.json, programmes.json…). */
  fichierAppli: nom => vraiFetch("/" + nom),

  async texte(chemin) {
    return (await Filesystem.readFile({ path: chemin, ...D, encoding: Encoding.UTF8 })).data;
  },

  async lire(chemin, defaut) {
    try { return JSON.parse(await this.texte(chemin)); } catch (e) { return defaut; }
  },

  ecrire(chemin, donnees) {
    const data = typeof donnees === "string" ? donnees : JSON.stringify(donnees);
    const tache = file.then(async () => {
      const tmp = chemin + ".tmp";
      await Filesystem.writeFile({ path: tmp, data, ...D, encoding: Encoding.UTF8, recursive: true });
      try { await Filesystem.deleteFile({ path: chemin, ...D }); } catch (e) { /* pas encore créé */ }
      await Filesystem.rename({ from: tmp, to: chemin, directory: Directory.Data, toDirectory: Directory.Data });
    });
    file = tache.catch(e => console.error("Écriture impossible", chemin, e));
    return tache;
  },

  async lister(dossier) {
    try {
      return (await Filesystem.readdir({ path: dossier, ...D })).files.map(f => (typeof f === "string" ? f : f.name));
    } catch (e) { return []; }
  },
};
