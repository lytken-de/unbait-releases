// Siderne, unbAIt DK kan virke på (v1.37). Bruges af baggrunden, indstillingerne og indholdsscriptet.
// builtin: Ekstra Bladet, B.T. og TV 2 har adgang fra installationen. De andre sider beder Chrome
// om lov første gang, brugeren sætter flueben (optional_host_permissions), og indholdsscriptet
// registreres først derefter (chrome.scripting.registerContentScripts).
const UNBAIT_SITES = [
  { id: "eb", name: "Ekstra Bladet", group: "tabloid", matches: ["*://*.ekstrabladet.dk/*", "*://*.eb.dk/*"], builtin: true },
  { id: "bt", name: "B.T.", group: "tabloid", matches: ["*://*.bt.dk/*"], builtin: true },
  { id: "seoghoer", name: "Se og Hør", group: "tabloid", matches: ["*://*.seoghoer.dk/*"] },
  { id: "billedbladet", name: "Billed-Bladet", group: "tabloid", matches: ["*://*.billedbladet.dk/*"] },
  { id: "tv2", name: "TV 2", group: "nyheder", matches: ["*://*.tv2.dk/*"], builtin: true },
  { id: "dr", name: "DR", group: "nyheder", matches: ["*://*.dr.dk/*"] },
  { id: "avisen", name: "Avisen.dk", group: "nyheder", matches: ["*://*.avisen.dk/*"] },
  { id: "nyheder24", name: "Nyheder24", group: "nyheder", matches: ["*://*.nyheder24.dk/*"] },
  // v1.89 (v1.88 genskabt): Y.dk – kortene er <article> med et link over hele kortet og overskriften i h1/h2/h3.
  // Skjul indhold: kun egne ord gælder, emnerne ikke (brugerens valg 6. nov. 2026, som JFM-medier)
  { id: "y", name: "Y.dk", group: "nyheder", matches: ["*://*.y.dk/*"] },
  { id: "politiken", name: "Politiken", group: "dagblade", matches: ["*://*.politiken.dk/*"] },
  { id: "berlingske", name: "Berlingske", group: "dagblade", matches: ["*://*.berlingske.dk/*"] },
  { id: "jp", name: "Jyllands-Posten", group: "dagblade", matches: ["*://*.jyllands-posten.dk/*"] },
  // v1.80: JFM-medier (Jysk Fynske Medier) – 20 lokale og regionale sider på samme platform, valgt samlet med ét flueben.
  // Overskrifterne er h3.teaser__title. Skjul indhold gælder ikke disse sider (brugerens valg 3. nov. 2026).
  { id: "jfm", name: "JFM-medier", group: "dagblade", matches: [
    "*://*.dagbladet-holstebro-struer.dk/*",
    "*://*.dbrs.dk/*",
    "*://*.folkebladetlemvig.dk/*",
    "*://*.frdb.dk/*",
    "*://*.fyens.dk/*",
    "*://*.faa.dk/*",
    "*://*.helsingordagblad.dk/*",
    "*://*.hsfo.dk/*",
    "*://*.jv.dk/*",
    "*://*.amtsavisen.dk/*",
    "*://*.vafo.dk/*",
    "*://*.viborg-folkeblad.dk/*",
    "*://*.stiften.dk/*",
    "*://*.avisendanmark.dk/*",
    "*://*.kobenhavnliv.dk/*",
    "*://*.amagerliv.dk/*",
    "*://*.frederiksbergliv.dk/*",
    "*://*.skanderborgliv.dk/*",
    "*://*.risskovliv.dk/*",
    "*://*.lystrupliv.dk/*"
  ] }
];
const DEFAULT_SITES = ["eb", "bt", "tv2"];
// "*://*.dr.dk/*" -> "dr.dk"
const siteDomains = (s) => s.matches.map(m => m.replace(/^\*:\/\/\*\./, "").replace(/\/\*$/, ""));
function siteForHost(host) {
  host = String(host || "").toLowerCase();
  return UNBAIT_SITES.find(s => siteDomains(s).some(d => host === d || host.endsWith("." + d))) || null;
}

