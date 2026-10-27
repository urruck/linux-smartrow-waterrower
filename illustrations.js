// Illustrations des exercices hors rameur : personnages en fil de fer, vue de côté.
// Chaque dessin a une ou deux poses (a et b) qui alternent pour montrer le mouvement.
// Repère : viewBox 0 0 300 200, sol à y = 172.

const SOL = 172;

function corps({ tete, tronc = [], bras = [], jambes = [], extra = "" }) {
  const pl = pts => `<polyline points="${pts.map(p => p.join(",")).join(" ")}"/>`;
  return `<circle cx="${tete[0]}" cy="${tete[1]}" r="11"/>` + pl(tronc) + bras.map(pl).join("") + jambes.map(pl).join("") + extra;
}

// Personnages réutilisables
const allongeGenouxPlies = (hanche = [135, 166], extra = "", genou = [175, 128]) => corps({
  tete: [58, 160], tronc: [[72, 164], hanche], bras: [[[80, 165], [125, 169]]],
  jambes: [[hanche, genou, [205, 169]]], extra,
});
const assis = (pied, extra = "") => corps({
  tete: [110, 62], tronc: [[110, 74], [110, 140]], bras: [[[110, 90], [128, 132]]],
  jambes: [[[110, 140], [165, 140], pied]], extra: `<line x1="80" y1="142" x2="150" y2="142" class="meuble"/>` +
    `<line x1="85" y1="142" x2="85" y2="${SOL}" class="meuble"/><line x1="145" y1="142" x2="145" y2="${SOL}" class="meuble"/>` + extra,
});
const debout = (talonHaut = 0, extra = "") => corps({
  tete: [150, 36 - talonHaut], tronc: [[150, 48 - talonHaut], [150, 110 - talonHaut]],
  bras: [[[150, 62 - talonHaut], [200, 70]]],
  jambes: [[[150, 110 - talonHaut], [150, 168 - talonHaut], [166, SOL]]],
  extra: `<line x1="205" y1="10" x2="205" y2="${SOL}" class="meuble"/>` + extra,
});

const FIGURES = {
  planche_genoux: {
    a: corps({ tete: [222, 120], tronc: [[95, 168], [205, 128]], bras: [[[205, 130], [205, 168], [240, 168]]], jambes: [[[95, 168], [50, 165]]] }),
  },
  planche: {
    a: corps({ tete: [228, 116], tronc: [[50, 168], [210, 126]], bras: [[[210, 128], [210, 168], [242, 168]]], jambes: [] }),
  },
  laterale: {
    a: corps({ tete: [222, 98], tronc: [[60, 168], [200, 108]], bras: [[[200, 110], [192, 168], [228, 168]], [[200, 108], [188, 40]]], jambes: [] }),
  },
  dead_bug: {
    a: corps({ tete: [62, 160], tronc: [[76, 164], [150, 166]], bras: [[[90, 164], [90, 100]]], jambes: [[[150, 166], [150, 120], [195, 120]]] }),
    b: corps({ tete: [62, 160], tronc: [[76, 164], [150, 166]], bras: [[[90, 164], [30, 140]]], jambes: [[[150, 166], [240, 150]]] }),
  },
  pont: { a: allongeGenouxPlies([135, 166]), b: allongeGenouxPlies([135, 139], "", [180, 121]) },
  bascule: { a: allongeGenouxPlies([135, 166]), b: allongeGenouxPlies([135, 160], `<text x="95" y="150" class="note">⇣</text>`) },
  releve: {
    a: allongeGenouxPlies([135, 166]),
    b: corps({ tete: [92, 112], tronc: [[100, 124], [135, 166]], bras: [[[105, 132], [160, 132]]], jambes: [[[135, 166], [175, 128], [205, 169]]] }),
  },
  respiration: {
    a: allongeGenouxPlies([135, 166], `<ellipse cx="110" cy="158" rx="16" ry="6" class="souffle"/>`),
    b: allongeGenouxPlies([135, 166], `<ellipse cx="110" cy="152" rx="20" ry="12" class="souffle"/>`),
  },
  bird_dog: {
    a: corps({ tete: [208, 112], tronc: [[110, 128], [190, 124]], bras: [[[190, 126], [190, 168]]], jambes: [[[110, 128], [110, 168], [70, 168]]] }),
    b: corps({ tete: [208, 112], tronc: [[110, 128], [190, 124]], bras: [[[190, 126], [190, 168]], [[190, 126], [255, 110]]],
      jambes: [[[110, 128], [110, 168], [70, 168]], [[110, 128], [40, 116]]] }),
  },
  ciseaux: {
    a: corps({ tete: [62, 160], tronc: [[76, 164], [150, 166]], bras: [[[90, 165], [140, 170]]], jambes: [[[150, 166], [235, 130]], [[150, 166], [235, 150]]] }),
    b: corps({ tete: [62, 160], tronc: [[76, 164], [150, 166]], bras: [[[90, 165], [140, 170]]], jambes: [[[150, 166], [235, 150]], [[150, 166], [235, 130]]] }),
  },
  superman: {
    a: corps({ tete: [232, 162], tronc: [[90, 168], [218, 166]], bras: [[[215, 166], [268, 168]]], jambes: [[[90, 168], [35, 168]]] }),
    b: corps({ tete: [228, 140], tronc: [[90, 166], [212, 150]], bras: [[[210, 150], [265, 128]]], jambes: [[[90, 166], [35, 145]]] }),
  },
  cercles: {
    a: assis([212, 150], `<circle cx="222" cy="150" r="16" class="fleche" stroke-dasharray="70 30"><animateTransform attributeName="transform" type="rotate" from="0 222 150" to="360 222 150" dur="2s" repeatCount="indefinite"/></circle>`),
  },
  alphabet: { a: assis([212, 150], `<text x="228" y="132" class="note">A B C…</text>`) },
  flexion: { a: assis([205, 128]), b: assis([215, 165]) },
  pointes: { a: debout(0), b: debout(10) },
  equilibre: {
    a: corps({ tete: [150, 36], tronc: [[150, 48], [150, 110]], bras: [[[150, 62], [200, 70]]],
      jambes: [[[150, 110], [150, 168], [166, SOL]], [[150, 110], [185, 125], [178, 160]]],
      extra: `<line x1="205" y1="10" x2="205" y2="${SOL}" class="meuble"/>` }),
  },
  mollets: {
    a: corps({ tete: [212, 52], tronc: [[200, 64], [160, 118]], bras: [[[195, 72], [244, 70]]],
      jambes: [[[160, 118], [200, 140], [205, SOL]], [[160, 118], [90, SOL], [75, SOL]]],
      extra: `<line x1="250" y1="10" x2="250" y2="${SOL}" class="meuble"/>` }),
  },
};

function cleFigure(nom) {
  const n = (nom || "").toLowerCase();
  const regles = [
    ["latérale", "laterale"], ["planche sur les genoux", "planche_genoux"], ["planche", "planche"],
    ["dead bug", "dead_bug"], ["pont", "pont"], ["bascule", "bascule"], ["relevé", "releve"],
    ["respiration", "respiration"], ["bird", "bird_dog"], ["ciseaux", "ciseaux"], ["superman", "superman"],
    ["cercles", "cercles"], ["alphabet", "alphabet"], ["flexion", "flexion"], ["pointes", "pointes"],
    ["équilibre", "equilibre"], ["mollets", "mollets"],
  ];
  const r = regles.find(([mot]) => n.includes(mot));
  return r ? r[1] : null;
}

// SVG complet d'un exercice (null si pas d'illustration)
function illustration(nom) {
  const f = FIGURES[cleFigure(nom)];
  if (!f) return null;
  const sol = `<line x1="10" y1="${SOL + 2}" x2="290" y2="${SOL + 2}" class="sol"/>`;
  const poses = f.b ? `<g class="pose-a">${f.a}</g><g class="pose-b">${f.b}</g>` : `<g>${f.a}</g>`;
  return `<svg viewBox="0 0 300 200" class="figure">${sol}${poses}</svg>`;
}
