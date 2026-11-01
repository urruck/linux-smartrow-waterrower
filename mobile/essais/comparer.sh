#!/usr/bin/env bash
# Compare la traduction JavaScript (src/) au programme Python d'origine :
# décodage de tous les messages de exemples/*.log et état complet de l'aventure.
# Usage : essais/comparer.sh [dossier de données]  (défaut ~/.local/share/rameur-smartrow)
set -euo pipefail
cd "$(dirname "$0")/.."
export RAMEUR_DONNEES="${1:-$HOME/.local/share/rameur-smartrow}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/essai.mjs" <<'JS'
import * as sr from "./src/smartrow.js";
import * as jeu from "./src/jeu.js";
import { readFileSync, readdirSync } from "node:fs";
const dec = [];
for (const f of readdirSync("../exemples").filter(f => f.endsWith(".log")))
  for (const l of readFileSync("../exemples/" + f, "utf8").split("\n").filter(x => x.trim())) {
    const p = l.split("\t")[1].trim().split(/\s+/).map(x => parseInt(x, 16));
    dec.push(sr.decoder(p), sr.decoder(p, true));
  }
console.log(JSON.stringify({ dec, jeu: await jeu.etat() }));
JS
cp "$T/essai.mjs" ./_essai.mjs
node -e '
require("esbuild").build({ entryPoints: ["_essai.mjs"], bundle: true, platform: "node", format: "esm",
  outfile: process.argv[1], logLevel: "warning",
  plugins: [{ name: "stockage", setup(b) { b.onResolve({ filter: /stockage\.js$/ },
    () => ({ path: require("path").resolve("essais/stockage_node.mjs") })); } }] })
  .catch(() => process.exit(1));' "$T/b.mjs"
rm -f _essai.mjs
node "$T/b.mjs" > "$T/js.json"
python3 - "$T/js.json" <<'PY'
import json, sys, os, glob, math
sys.path.insert(0, "..")
import smartrow_ble as sr, jeu
dec = []
for f in sorted(glob.glob("../exemples/*.log")):
    for l in open(f, encoding="utf-8"):
        if l.strip():
            p = bytes(int(x, 16) for x in l.split("\t")[1].split())
            for v3 in (False, True):
                t, v = sr.decoder(p, v3)
                dec.append([t, v])
py = json.loads(json.dumps({"dec": dec, "jeu": jeu.etat()}, default=str))
js = json.load(open(sys.argv[1]))
ecarts = []
def cmp(a, b, ch):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            cmp(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{ch}.{k}")
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            cmp(x, y, f"{ch}[{i}]")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if not math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9):
            ecarts.append((ch, a, b))
    elif a != b:
        ecarts.append((ch, a, b))
cmp(py, js, "")
print(f"{len(dec) // 2} messages décodés, {len(py['jeu']['journal'])} séances au journal, niveau {py['jeu']['niveau']['numero']}")
for e in ecarts[:30]:
    print("ÉCART", *e)
print("IDENTIQUE" if not ecarts else f"{len(ecarts)} écarts")
sys.exit(1 if ecarts else 0)
PY
