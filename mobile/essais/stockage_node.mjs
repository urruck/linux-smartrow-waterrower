// Remplaçant de src/stockage.js pour les essais sous Node (lecture d'un dossier).
import { readFileSync, readdirSync } from "node:fs";
const BASE = process.env.RAMEUR_DONNEES, APPLI = process.cwd() + "/../";  // lancé depuis mobile/
export const stock = {
  fichierAppli: async nom => ({ json: async () => JSON.parse(readFileSync(APPLI + nom, "utf8")) }),
  texte: async c => readFileSync(`${BASE}/${c}`, "utf8"),
  async lire(c, d) { try { return JSON.parse(await this.texte(c)); } catch (e) { return d; } },
  async ecrire() { throw new Error("lecture seule pendant l'essai"); },
  async lister(d) { try { return readdirSync(`${BASE}/${d}`); } catch (e) { return []; } },
};
