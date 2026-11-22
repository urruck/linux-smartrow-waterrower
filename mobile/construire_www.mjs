// Prépare www/ pour Capacitor : la page de l'application Linux, précédée des
// modules de src/ (qui remplacent rameur.py dans le téléphone).
//
// Aucun outil d'assemblage : Capacitor et ses greffons sont copiés tels quels
// de node_modules (versions « plugin.js » prêtes pour le navigateur), nos
// fichiers de src/ sont des modules JavaScript chargés directement. Seul
// Node.js est nécessaire (construction reproductible, acceptée par F-Droid).
//
//   node construire_www.mjs            -> www/
//   node construire_www.mjs --android  -> www/ puis copie dans le projet Android
//                                         (ce que fait « npx cap copy android »)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const RACINE = "..", WWW = "www";
rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW + "/exemples", { recursive: true });
mkdirSync(WWW + "/lib", { recursive: true });

// Capacitor et greffons (scripts classiques, dans cet ordre)
const LIBS = [
  ["@capacitor/core/dist/capacitor.js", "capacitor.js"],
  ["@capacitor/synapse/dist/synapse.js", "synapse.js"],
  ["@capacitor/app/dist/plugin.js", "app.js"],
  ["@capacitor/filesystem/dist/plugin.js", "filesystem.js"],
  ["@capacitor/share/dist/plugin.js", "share.js"],
  ["@capacitor-community/bluetooth-le/dist/plugin.js", "bluetooth-le.js"],
  ["@capacitor-community/keep-awake/dist/plugin.js", "keep-awake.js"],
  ["@capacitor-community/text-to-speech/dist/plugin.js", "text-to-speech.js"],
];
const sansCarte = t => t.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
for (const [src, dst] of LIBS) {
  writeFileSync(`${WWW}/lib/${dst}`, sansCarte(readFileSync("node_modules/" + src, "utf8")));
}
const scriptsLibs = LIBS.map(([, dst]) => `<script src="/lib/${dst}"></script>`)
  .join("\n")
  // filesystem.js attend la variable globale « synapse »
  .replace('<script src="/lib/app.js">', '<script>window.synapse = window.outsystemsSynapse;</script>\n<script src="/lib/app.js">');

cpSync("src", `${WWW}/src`, { recursive: true });

// Page : le script principal devient un module, exécuté après src/serveur.js
// (les modules s'exécutent dans l'ordre du document).
const page = readFileSync(`${RACINE}/page.html`, "utf8");
const repere = '<script src="/illustrations.js"></script>\n<script>';
if (!page.includes(repere)) throw new Error("page.html : script principal introuvable");
writeFileSync(`${WWW}/index.html`, page
  .replace("</title>", '</title>\n<link rel="icon" href="/rameur-smartrow.svg">')
  .replace(repere, scriptsLibs + '\n<script type="module" src="/src/serveur.js"></script>\n' +
    '<script src="/illustrations.js"></script>\n<script type="module">'));

for (const f of ["illustrations.js", "jeu.json", "programmes.json", "recettes.json", "rameur-smartrow.svg"]) {
  cpSync(`${RACINE}/${f}`, `${WWW}/${f}`);
}
cpSync(`${RACINE}/exemples/seance-260m.log`, `${WWW}/exemples/seance-260m.log`);
console.log("www/ prêt.");

if (process.argv.includes("--android")) {
  const ASSETS = "android/app/src/main/assets";
  rmSync(`${ASSETS}/public`, { recursive: true, force: true });
  cpSync(WWW, `${ASSETS}/public`, { recursive: true });
  writeFileSync(`${ASSETS}/capacitor.config.json`, JSON.stringify(JSON.parse(readFileSync("capacitor.config.json", "utf8")), null, "\t") + "\n");
  for (const f of ["capacitor.plugins.json"]) {
    if (!existsSync(`${ASSETS}/${f}`)) throw new Error(`${ASSETS}/${f} manquant : lancez une fois « npx cap sync android »`);
  }
  console.log(`Copié dans ${ASSETS}/public (${readdirSync(`${ASSETS}/public`).length} éléments).`);
}
