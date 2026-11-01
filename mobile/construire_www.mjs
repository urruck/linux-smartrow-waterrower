// Prépare www/ pour Capacitor : la page de l'application Linux, inchangée,
// précédée de serveur.js (qui remplace rameur.py dans le téléphone).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const RACINE = "..", WWW = "www";
rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW + "/exemples", { recursive: true });

const page = readFileSync(`${RACINE}/page.html`, "utf8");
const repere = '<script src="/illustrations.js"></script>';
if (!page.includes(repere)) throw new Error("page.html : balise illustrations.js introuvable");
writeFileSync(`${WWW}/index.html`, page
  .replace("</title>", '</title>\n<link rel="icon" href="/rameur-smartrow.svg">')
  .replace(repere, '<script src="/serveur.js"></script>\n' + repere));

for (const f of ["illustrations.js", "jeu.json", "programmes.json", "recettes.json", "rameur-smartrow.svg"]) {
  cpSync(`${RACINE}/${f}`, `${WWW}/${f}`);
}
cpSync(`${RACINE}/exemples/seance-260m.log`, `${WWW}/exemples/seance-260m.log`);

await build({
  entryPoints: ["src/serveur.js"], bundle: true, format: "iife", target: "chrome90",
  outfile: `${WWW}/serveur.js`, minify: false, legalComments: "none",
});
console.log("www/ prêt.");
