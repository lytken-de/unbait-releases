(function () {
  "use strict";

  // Siden findes ud fra adressen og den fælles liste i sites.js (v1.37)
  const SITE = (typeof siteForHost === "function" && siteForHost(location.hostname)?.id) || null;
  if (!SITE) return;
  // Sider, der er bygget som Ekstra Bladet (.dre-item) eller som B.T. (TeaserLink) (v1.37)
  const DRE_SITE = SITE === "eb" || SITE === "seoghoer" || SITE === "billedbladet";
  const TEASER_SITE = SITE === "bt" || SITE === "berlingske";
  const NEW_SITE = !["eb", "bt", "tv2"].includes(SITE);   // siderne fra v1.37
  // v1.80: JFM-medier (20 sider fra Jysk Fynske Medier, samme platform): overskrifterne er h3.teaser__title
  const JFM = SITE === "jfm";
  // v1.89: Y.dk – emnerne under Skjul indhold gælder ikke (kun egne ord), som JFM-medier
  const YDK = SITE === "y";
  // DR's TV- og lydsider (dr.dk/tv/ og dr.dk/lyd/): her er unbAIt DK ikke aktiv – ingen omskrivning,
  // intet skjult og ingen statusboks. Tjekkes igen, når siden skifter adresse uden genindlæsning (v1.42)
  // v1.79: DR TV ligger nu på /drtv/ (/tv/ sender videre dertil), så /tv er erstattet af /drtv
  const offPath = () => SITE === "dr" && /^\/(drtv|lyd)(\/|$)/i.test(location.pathname);

  // ---------------------------------------------------------------------
  // Tilstand
  // enabled følger storage.sync, så alle åbne faner følger samme tænd/sluk (fund 03).
  // runId tælles op ved sluk; arbejde fra en tidligere runde må aldrig ændre siden (fund 02).
  // ---------------------------------------------------------------------
  let enabled = false;
  let runId = 0;
  const inserted = new WeakMap(); // el -> den AI-tekst, vi senest har indsat (må aldrig blive "original")
  const cards = new WeakMap();   // el -> { url, origText, label, jobToken, jobId, nodes, span, anchor, rewritten, showing, kept }
  const tracked = new Set();     // elementer med tilstand (til oprydning ved sluk)
  const timers = new Set();      // genprøvnings-timere, der skal ryddes ved sluk
  let statusEl = null, processedCount = 0, failCount = 0, lastError = "";

  // Tekster der er sektions-/kategorinavne og ikke overskrifter
  const NOT_HEADLINE = /^(seneste nyheder|mest læste|læs også|se også|nyheder|sport|samfund|udland|politik|underholdning|tv 2 play|live|video|annonce|simon siger)$/i;
  // Overskrifter i navigation, sidehoved, sidefod, dialoger og formularer er ikke nyheder (fund S02)
  // <header> afvises kun, når det er sidens globale sidehoved – ikke en header inde i en artikel/et nyhedskort (R04)
  const NOT_CONTENT = "nav, footer, form, dialog, [role='navigation'], [role='banner'], [role='contentinfo'], [role='dialog'], [role='menu'], [aria-modal='true']";
  const CONTENT_SCOPE = "article, main, [role='main'], [class*='teaser'], [class*='Teaser'], [class*='card'], [class*='dre-item']";
  function inExcludedRegion(el) {
    if (el.closest(NOT_CONTENT.replace("form, ", ""))) return true;
    // Avisen.dk (ASP.NET) har hele siden inde i én formular (#aspnetForm); den tæller ikke som formular (v1.37)
    const f = el.closest("form");
    if (f && !(SITE === "avisen" && f.id === "aspnetForm")) return true;
    const h = el.closest("header");
    return !!(h && !h.closest(CONTENT_SCOPE));
  }

  // Udvidelsens egne ændringer: kør dem og smid de mutationer væk, de skabte.
  // Så kan observeren også se sidens ændringer INDE i den indsatte tekst (R02).
  let mo = null;
  function selfWrite(fn) {
    flushPending();                 // sidens ændringer, der allerede venter, behandles først (R02a)
    const r = fn();
    if (mo) mo.takeRecords();       // det, der nu ligger i køen, er kun vores egne ændringer
    return r;
  }
  function flushPending() {
    if (mo) { const recs = mo.takeRecords(); if (recs.length) { scanText?.clear(); handleMutations(recs); } }
  }

  function isOwn(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!el?.closest?.("#unbait-status, .unbait-text, .unbait-toggle, .unbait-ph");
  }

  // v1.93: detail = fejlteksten på sin egen linje under tælleren (højst 120 tegn), så fx hele Kilo-beskeden kan ses
  // v1.97 (M5): samme form som på indstillingssiden – showStatus(besked, { error, detail })
  function showStatus(msg, { error = false, detail = "" } = {}) { selfWrite(() => showStatusInner(msg, error, detail)); }
  let aiName = "";   // vises diskret i statusboksen
  let lastStatus = null, lastDetail = "", lastMsg = "", lastIsError = false;   // det, statusboksen viser nu
  const STATUS_DETAIL_MAX = 120;
  function showStatusInner(msg, isError, detail = "") {
    const text = "unbAIt DK: " + msg;
    detail = String(detail || "").replace(/\s+/g, " ").trim();
    if (detail.length > STATUS_DETAIL_MAX) detail = detail.slice(0, STATUS_DETAIL_MAX - 1).trimEnd() + "…";
    lastDetail = detail; lastMsg = msg; lastIsError = !!isError;
    const key = text + "|" + detail + "|" + aiName + "|" + isError;
    if (statusEl?.isConnected && lastStatus === key) return; // ingen unødige ændringer (fund S04)
    lastStatus = key;
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = "unbait-status";
      statusEl.setAttribute("role", "status");
      statusEl.style.cssText = `
        position: fixed; bottom: 12px; right: 12px; z-index: 2147483647;
        background: #111; color: #fff; padding: 8px 12px; border-radius: 8px;
        font: 13px/1.3 system-ui,sans-serif; max-width: 320px;
        box-shadow: 0 4px 16px rgba(0,0,0,.4); pointer-events: none;
      `;
    }
    // Nogle sider (fx DR) fjerner fremmede elementer, når deres eget script overtager siden (v1.40)
    if (!statusEl.isConnected) (document.body || document.documentElement).appendChild(statusEl);
    statusEl.style.background = isError ? "#b91c1c" : "#111";
    const main = document.createElement("div");
    main.textContent = text;
    statusEl.replaceChildren(main);
    if (detail) {
      const d = document.createElement("div");
      d.className = "unbait-status-detail";
      d.textContent = detail;
      d.style.cssText = "margin-top:2px;";
      statusEl.appendChild(d);
    }
    if (aiName) {
      const sub = document.createElement("div");
      sub.textContent = aiName;
      sub.style.cssText = "font-size:11px; opacity:.6; margin-top:2px;";
      statusEl.appendChild(sub);
    }
    statusEl.style.opacity = "1";
    clearTimeout(statusEl._t);
    statusEl._t = setTimeout(() => { if (statusEl) statusEl.style.opacity = "0.4"; }, 8000);
  }

  // v1.92: overskriftens tekst læses robust (brugerens fund 9. nov. 2026: »Alle elsker Rasmus« på Se og Hør blev ikke
  // skjult). EB og Se og Hør har overskriften i tre størrelser (alt-title--lg/md/sm) med ét <p> pr. linje. Var kortet ikke
  // tegnet endnu, gav innerText den rå tekst – alle tre størrelser og uden mellemrum (»Alleelsker«). Nu: kun den synlige
  // størrelse (ellers den første), og er den ikke tegnet, linjeskift mellem afsnit og linjer.
  const BLOCK_TAGS = /^(P|DIV|BR|LI|UL|OL|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|FIGCAPTION|BLOCKQUOTE|TR|TD|TH|DT|DD)$/;
  function textWithBreaks(root) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return;
      const block = BLOCK_TAGS.test(n.tagName);
      if (block) out += "\n";
      for (const c of n.childNodes) walk(c);
      if (block) out += "\n";
    };
    walk(root);
    return out;
  }
  function readText(el) {
    let root = el;
    const variants = [...el.querySelectorAll('[class*="alt-title--"]')].filter(v => !v.parentElement?.closest('[class*="alt-title--"]') || !el.contains(v.parentElement.closest('[class*="alt-title--"]')));
    if (variants.length > 1) {
      // Kun hvis overskriften ikke har anden tekst uden for størrelserne
      const inside = variants.reduce((n, v) => n + v.textContent.replace(/\s+/g, "").length, 0);
      if (el.textContent.replace(/\s+/g, "").length <= inside) root = variants.find(v => v.getClientRects().length > 0) || variants[0];
    }
    return root.getClientRects().length > 0 ? (root.innerText || "") : textWithBreaks(root);
  }

  // v1.97 (M7): under én scanning læses hver overskrifts tekst højst én gang (skjul-reglerne og udvælgelsen læste den hver sin gang).
  // Tømmes, når sidens ventende ændringer behandles (flushPending), så en ændring aldrig gemmer sig bag en gammel tekst
  let scanText = null;
  function cleanText(el) {
    if (scanText?.has(el)) return scanText.get(el);
    const t = cleanTextNow(el);
    scanText?.set(el, t);
    return t;
  }
  function cleanTextNow(el) {
    // Et ord delt med bindestreg over to linjer ("Konge-" / "mærke" på B.T.) samles til "Konge-mærke" (v1.31).
    // Kun ved linjeskift, og ikke foran "og"/"eller" ("sommer-" / "og vinterferie").
    return (readText(el) || el.textContent || "")
      .replace(JFM ? /\u00AD/g : /(?!)/g, "")   // v1.80: JFM's bløde bindestreger (»Stel\u00ADla«) er ikke en del af teksten
      .replace(/(\p{L})-[ \t]*\n\s*(?!(?:og|eller)(?![\p{L}]))(?=\p{L})/gu, "$1-")
      .replace(/\s+/g, " ").trim();
  }

  function looksLikeHeadline(text) {
    // Ekstra Bladets overskrifter kan være ét enkelt ord ("Stopper!"). Teksten sidder i deres
    // overskriftsfelt (.dre-item__title), så den behøver ikke flere ord for at være en overskrift.
    // Det samme gælder B.T. (v1.31): linket (TeaserLink) rummer kun overskriften – mærkater som
    // "Log ind og læs" ligger uden for linket. Fx "Han er landet" og "Konge-mærke".
    // Fra v1.37 gælder det alle sider undtagen TV 2: overskriftsfelterne er fundet præcist pr. side.
    const short = SITE !== "tv2";
    const minLen = short ? 3 : 15, minWords = short ? 1 : 4;
    if (text.length < minLen || text.length > 180) return false;
    if (text.split(" ").length < minWords) return false;
    return !NOT_HEADLINE.test(text);
  }

  function isCandidate(el) {
    if (inExcludedRegion(el)) return false;
    if (el.querySelector("img, picture, video, figure")) return false;
    const owner = el.parentElement?.closest("[data-unbait]");
    if (owner) return false;                       // ligger i en overskrift, vi allerede har
    if (el.querySelector("[data-unbait]")) return false;
    return true;
  }

  function findArticleUrl(el) {
    // v1.89: Y.dk – linket ligger enten om overskriften eller som et lag over hele kortet (<article> > a).
    // Artikelsidens egen overskrift står i en <article> med links i brødteksten; den har intet lag og sendes ikke.
    // v1.95: det samme på Jyllands-Posten efter det nye design
    const a = (YDK || SITE === "jp") ? el.closest("a[href]") || el.closest("article")?.querySelector(":scope > a[href]")
      : el.closest("a[href]") || el.querySelector("a[href]") ||
        el.closest("article, [class*='teaser'], [class*='Teaser'], [class*='dre-item']")?.querySelector("a[href]");
    if (!a) return "";
    // Kun http- og https-links (ikke fx javascript: eller mailto:)
    try { const u = new URL(a.getAttribute("href"), location.href); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
  }

  // ---------------------------------------------------------------------
  // Skjul historier: emner (ud fra artiklens adresse), Ekstra Bladet+ og egne ord.
  // Reglerne er lavet ud fra de rigtige forsider. Skjulte historier sendes aldrig til AI'en.
  // ---------------------------------------------------------------------
  const H_EB = /(^|\.)ekstrabladet\.dk$/, H_BT = /(^|\.)bt\.dk$/, H_TV2 = /^(www\.)?tv2\.dk$/, H_TV2N = /^nyheder\.tv2\.dk$/;
  const BT_SPORT = "sport|fodbold|superliga|tennis|cykling|haandbold|formel-1|motorsport|golf|ishockey|badminton|boksning|mma|esport|atletik|amerikansk-fodbold|basketball";
  const HIDE_RULES = {
    // bold.dk (fodbold) og feltet.dk (cykling) linkes fra EB's forside og er altid sport (v1.18)
    sport: [[H_EB, /^\/sport\//], [H_BT, new RegExp(`^/(${BT_SPORT})/`)], [/^sport\.tv2\.dk$/, /^/], [H_TV2, /^\/sport\//],
      [/(^|\.)bold\.dk$/, /^/], [/(^|\.)feltet\.dk$/, /^/]],
    underholdning: [[H_EB, /^\/(underholdning|musik|side9)\//], [H_BT, /^\/(underholdning|danske-kendte|int-kendte|royale|film-tv-og-streaming|musik)\//],
      [/^underholdning\.tv2\.dk$/, /^/], [H_TV2, /^\/underholdning\//]],
    krimi: [[H_EB, /^\/krimi\//], [H_BT, /^\/krimi\//], [H_TV2N, /^\/(live\/)?krimi(\/|$)/]],
    sex: [[H_EB, /^\/sex_og_samliv\//], [/^livsstil\.tv2\.dk$/, /^\/samliv/]],
    penge: [[H_EB, /^\/(forbrug|penge)\//], [H_BT, /^\/(forbrug|penge)\//], [H_TV2N, /^\/(live\/)?penge(\/|$)/], [/^livsstil\.tv2\.dk$/, /^\/forbrug/]],
    video: [[H_EB, /^\/(play|podcast)\//], [H_BT, /^\/(video|podcast)\//], [H_TV2, /^\/(reel|reels)(\/|$)/], [/^play\.tv2\.dk$/, /^/]]
  };
  // De nye sider (v1.37) – lavet ud fra brugerens forsider 22. okt. 2026. Avisen.dk har ikke emnet i
  // adressen; der bruges kortets klasse (Category-krimi osv., se AVISEN_CATS).
  const hostRe = (d) => new RegExp(`(^|\\.)${d.replace(/\./g, "\\.")}$`);
  const H_DR = hostRe("dr.dk"), H_POL = hostRe("politiken.dk"), H_BER = hostRe("berlingske.dk"), H_JP = hostRe("jyllands-posten.dk"),
    H_N24 = hostRe("nyheder24.dk"), H_SH = hostRe("seoghoer.dk"), H_BB = hostRe("billedbladet.dk");
  const ANY_REEL = /\/reels?\//;
  HIDE_RULES.sport.push([H_DR, /^\/sporten\//], [H_POL, /^\/sport\//], [H_BER, /^\/sport\//], [H_JP, /^\/sport\//], [H_SH, /^\/sport\//], [H_N24, /^\/sport\//]);
  HIDE_RULES.underholdning.push([H_SH, /^\/(kendte|reality|hollywood|kongelige)\//], [H_BB, /^\/(kendte|kongelige)\//], [H_N24, /^\/(kendte|kongehuset)\//]);
  HIDE_RULES.krimi.push([H_SH, /^\/krimi\//], [H_N24, /^\/112\//]);
  HIDE_RULES.penge.push([H_DR, /^\/nyheder\/penge\//], [H_POL, /^\/danmark\/(oekonomi|forbrug)\//], [H_BER, /^\/dine-penge\//],
    [H_N24, /^\/(penge|forbrug)\//], [H_SH, /^\/nyheder\/dine-penge\//]);
  HIDE_RULES.video.push([H_DR, ANY_REEL], [H_DR, /^\/(drtv|lyd)\//], [H_POL, /^\/(podcast|shorts)\//], [H_BER, /^\/video\//],
    [H_JP, /^\/(podcast|lyt)\//], [H_BB, ANY_REEL], [H_SH, ANY_REEL]);
  const AVISEN_CATS = { sport: ["sport"], krimi: ["krimi"], underholdning: ["underholdning", "kongelige", "filmogtv"] };
  const HIDE_LABELS = { sport: "Sport", underholdning: "Kendte og underholdning", krimi: "Krimi", sex: "Sex og samliv",
    penge: "Forbrug og penge", video: "Video og podcasts" };
  // Hele nyhedskortet, der skal skjules
  // EB's karruseller ("Nyeste fra Bold", "Populært i Ekstra Bladet+" …) har kort af typen a.list-item.
  // De skjules som andre kort, men omskrives ikke (v1.18).
  const CAROUSEL_ITEM = ".horizontal-container a.list-item";
  // DR's blok "Mere fra dr.dk" på artikelsiderne (v1.76)
  const DR_MORE = "#hydra-more-news", DR_MORE_CELL = "#hydra-more-news .dre-grid-layout-cell", DR_MORE_CARD = "#hydra-more-news .dre-article-teaser";
  const CARD_SEL = { eb: [".dre-item", CAROUSEL_ITEM], bt: ["[class*='TeaserClickArea_container']", "[class*='Teaser_container']"], tv2: [".tc_teaser"],
    // v1.37
    // Se og Hør: de små kort på undersiderne (fx /kendte, /nyheder/dine-penge) skjules med hele <article> (v1.48)
    seoghoer: [".dre-item", "article"], billedbladet: [".dre-item"], berlingske: ["[class*='TeaserClickArea_container']", "[class*='Teaser_container']"],
    // DR: kort i en karrusel ("Seneste nyt") skjules med hele karrusel-punktet, ellers bliver punktets
    // udregnede bredde stående som et hul. Tjekkes først, så en hel sektion aldrig skjules (v1.40)
    // v1.76: kortene i "… lige nu"/"Seneste om …" (#hydra-more-news) skjules med hele gitter-cellen (billede og tekst)
    dr: [DR_MORE_CELL, DR_MORE_CARD, "li.dre-slide-band-track-item", ".hydra-front-page-item", ".hydra-latest-news-item", ".hydra-card"],
    // Avisen.dk: kortene i boksen "Forbrugerguides" skjules med hele boksen inkl. overskriften (v1.41)
    avisen: [".ThemeBox.Category-forbrugerguides", "a.FrontpageBox"],
    nyheder24: ["article.post-card", "a.recent-news-slider__item"], politiken: ["article", "li"], jp: ["article", "li"],
    // v1.83: JFM-medier – punktet i »Mest læste« eller hele kortet
    jfm: ["li.list__item", "article.teaser", "article.related-article"],   // v1.96: kortet i »Læs også«
    // v1.89: Y.dk – hele kortet
    y: ["article"] };
  // BT's podcast-række ("PODCAST"): kortene skjules som andre kort, men omskrives ikke. Kortet er listepunktet
  // i slideren, og hele rækken med overskrift (Slider_container) skjules, når alle kort er skjult (v1.30).
  const BT_PODCAST = "a[class*='PodcastEpisodeTeaser_link']";
  const BT_PODCAST_ITEM = "li[class*='Slider_listItem']", BT_PODCAST_ROW = "div[class*='Slider_container']";
  // BT's korte videoer (bt.dk/video/reels/<kode>) har hverken uddrag eller ord i adressen og sendes ikke til AI'en (v1.30)
  // v1.94: passer adressens domæne og sti? (ugyldig adresse = nej)
  const urlIs = (url, hostRe, pathRe) => { try { const u = new URL(url); return hostRe.test(u.hostname) && pathRe.test(u.pathname); } catch { return false; } };
  const isBtReel = (url) => urlIs(url, H_BT, /^\/video\/reels\//);
  // BT's spil (bt.dk/spil/, fx "Gæt dagens ord" og "Det lille krydsord") sendes heller ikke til AI'en (v1.31)
  const isBtGame = (url) => urlIs(url, H_BT, /^\/spil(\/|$)/);
  // De nye sider (v1.37): korte videoer (…/reels/…), links til andre sider og sider, der ikke er
  // artikler (nyhedsbrev, spil, abonnement …), sendes ikke til AI'en
  function isNewSiteSkip(url) {
    if (!NEW_SITE || !url) return false;
    try {
      const u = new URL(url);
      if (siteForHost(u.hostname)?.id !== SITE || /^e-?avis\./.test(u.hostname)) return true;   // andre sider og e-avisen
      if (ANY_REEL.test(u.pathname) || /^\/(nyhedsbrev|nyhedsbreve|spil|abonnement|shop|horoskoper|skribent)(\/|$)/.test(u.pathname)) return true;
      if (SITE === "dr" && /^\/(etik-og-rettelser|om-dr)\//.test(u.pathname)) return true;          // DR's rettelser og "Om DR"
      if (SITE === "billedbladet" && /^\/billed-bladet\//.test(u.pathname)) return true;            // reklamer for bladet
      return false;
    } catch { return false; }
  }
  // v1.79: TV 2's korte videoer (fx tv2.dk/penge/reel/…) har hverken uddrag eller brugbar tekst og sendes ikke til AI'en
  const isTv2Reel = (url) => urlIs(url, /(^|\.)tv2\.dk$/, /(^|\/)reels?\//);
  const noAI = (url) => isBtReel(url) || isBtGame(url) || isTv2Reel(url) || isNewSiteSkip(url);
  // Avisen.dk's annoncer (kort med klassen Category-advertorial, "Annonce …") sendes heller ikke til AI'en (v1.37)
  // Fra v1.41 heller ikke boksen "Forbrugerguides" (Category-forbrugerguides), der også er annoncer
  const AVISEN_ADS = ".Category-advertorial, .Category-forbrugerguides";
  // v1.79: en overskrift uden link til en artikel (fx TV 2's »Mest sete på tv2.dk« og SEO-boksens »Få overblik over …«)
  // er ikke en nyhed og sendes ikke til AI'en
  const noAIEl = (el) => { const u = findArticleUrl(el); return !u || noAI(u) || (SITE === "avisen" && !!el.closest(AVISEN_ADS)); };
  // Avisen.dk's boks "Partnerlinks" har ingen overskrifter; den skjules for sig (v1.41)
  const AVISEN_PARTNER = ".page_SponsoredLinksFP";

  let hideCfg = { cats: [], plus: false, ads: false, adsAvisen: false, games: false, words: [], mode: "remove" };
  const hiddenRoots = new Map();   // kort -> pladsholder (eller null)
  const hiddenGroups = new Set();  // EB-grupper og BT's podcast-række, hvor alle kort er skjult
  const revealed = new WeakSet();  // kort, brugeren selv har klikket frem
  const excerptText = new WeakMap(); // overskrift -> artiklens uddrag med små bogstaver (v1.77: egne ord tjekkes også her)
  // v1.78: egne ord tjekkes også i artiklens adresse. Begge sider skrives som adressen: små bogstaver, æ/ø/å som ae/oe/aa,
  // alt andet end bogstaver og tal som ét mellemrum
  const asAddress = (s) => String(s || "").toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, " ").trim();
  function addressWords(url) {
    try { const u = new URL(url, location.href); let p = u.pathname; try { p = decodeURIComponent(p); } catch {} return " " + asAddress(p) + " "; }
    catch { return ""; }
  }

  function parseWords(s) {
    return String(s || "").split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(w => w.length >= 2);
  }
  async function loadHideCfg() {
    try {
      const s = await chrome.storage.sync.get(HIDE_DEFAULTS);   // standardværdierne står i shared.js (v1.94)
      hideCfg = { cats: Array.isArray(s.hideCats) ? s.hideCats : [], plus: !!s.hidePlus, ads: !!s.hideAds, adsAvisen: !!s.hideAdsAvisen, games: !!s.hideGames,
        words: parseWords(s.hideWords), mode: s.hideMode === "dim" ? "dim" : "remove" };
    } catch {}
  }
  const hideActive = () => hideCfg.cats.length > 0 || hideCfg.plus || hideCfg.ads || hideCfg.adsAvisen || hideCfg.games || hideCfg.words.length > 0;

  function cardRoot(el) {
    if (SITE === "bt" && el.matches(BT_PODCAST)) return el.closest(BT_PODCAST_ITEM) || el;
    for (const sel of CARD_SEL[SITE] || []) { const r = el.closest(sel); if (r) return r; }
    return el.closest("a") || el;
  }

  const EB_PLUS_BANNER = '.iframe-banner-container:has(iframe[data-desktop-url*="/bannerhtml/data/PLUS/"], iframe[src*="/bannerhtml/data/PLUS/"], a.iframe-clicktag-overlay[href*="/kampagner/"])';
  function ebPlusPromos() {
    const out = new Set();
    for (const b of document.querySelectorAll(EB_PLUS_BANNER)) out.add(b.closest(".fnSpaceManagement") || b);
    for (const b of document.querySelectorAll(".plus-footer")) out.add(b);
    return [...out];
  }

  function hideReasonFor(el, root) {
    // v1.80: emnerne gælder ikke JFM-medierne (brugerens valg); v1.83: egne ord gælder (se nedenfor)
    if (!hideActive() || revealed.has(root)) return "";
    if (el.querySelector("[data-unbait]")) return ""; // vurderes ud fra overskriften inden i
    if (hideCfg.plus && SITE === "eb" &&
        (root.matches(".dre-item--feature-plus") || root.querySelector(".dre-feature-snippet--plus, .icon-plus-anim, .premium-dogear"))) return "Ekstra Bladet+";
    const url = findArticleUrl(el);
    // Annoncer: EB's kommercielle sider (fx karrusellen "Populært på Ekstra Bladet Pristjek") (v1.21)
    // Spil: B.T.'s spil (bt.dk/spil/) (v1.31)
    if (hideCfg.games && SITE === "bt" && url && isBtGame(url)) return "Spil";
    if (hideCfg.ads && SITE === "eb" && url && urlIs(url, H_EB, /^\/kommerciel\//)) return "Annonce";
    // Annoncer på Avisen.dk: advertorials og hele boksen "Forbrugerguides" (v1.41)
    if (hideCfg.adsAvisen && SITE === "avisen" && root.closest?.(AVISEN_ADS)) return "Annonce";
    if (SITE === "avisen" && hideCfg.cats.length) {
      const cls = [...(root.classList || [])].find(c => c.startsWith("Category-"))?.slice(9).toLowerCase();
      for (const c of hideCfg.cats) if (cls && (AVISEN_CATS[c] || []).includes(cls)) return HIDE_LABELS[c];
    }
    if (url && hideCfg.cats.length && !JFM && !YDK) {   // v1.89: heller ikke Y.dk
      try {
        const u = new URL(url);
        for (const c of hideCfg.cats) {
          if ((HIDE_RULES[c] || []).some(([h, p]) => h.test(u.hostname) && p.test(u.pathname))) return HIDE_LABELS[c];
        }
      } catch {}
    }
    if (hideCfg.words.length) {
      const c = cards.get(el);
      // Altid den originale overskrift. I karrusellerne kun selve titlen (ikke emne-mærkat og "Gem")
      const titleEl = el.matches(CAROUSEL_ITEM) ? (el.querySelector(".list-item-title") || el) : el;
      const text = (c ? c.origText : cleanText(titleEl)).toLowerCase();
      // v1.77: også artiklens uddrag, når det er hentet (før AI-kaldet). Gemte omskrivninger tjekkes kun på overskriften
      const ex = excerptText.get(el) || "";
      // v1.78: også artiklens adresse (fx …/troels-mylenbergs-doed…): bindestreger som mellemrum, æ/ø/å som ae/oe/aa
      const adr = url ? addressWords(url) : "";
      const w = hideCfg.words.find(w => text.includes(w) || ex.includes(w) || (adr && asAddress(w) && adr.includes(asAddress(w))));
      if (w) return `"${w}"`;
    }
    return "";
  }

  function makePlaceholder(root, reason) {
    const ph = document.createElement("span");
    ph.className = "unbait-ph";
    ph.setAttribute("role", "button");
    ph.tabIndex = 0;
    ph.textContent = `Skjult: ${reason} – klik for at vise`;
    const show = (e) => {
      e.preventDefault(); e.stopPropagation(); // pladsholderen kan ligge inde i et link
      revealed.add(root);
      unhideRoot(root);
      updateGroups();
      updateStatus();
      scan();
    };
    ph.addEventListener("click", show);
    ph.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") show(e); });
    return ph;
  }

  function hideRoot(root, reason) {
    if (hiddenRoots.has(root) && root.getAttribute("data-unbait-hide") === hideCfg.mode) return;
    injectStyleOnce();
    selfWrite(() => {
      hiddenRoots.get(root)?.remove();
      root.setAttribute("data-unbait-hide", hideCfg.mode);
      let ph = null;
      if (hideCfg.mode === "dim") { ph = makePlaceholder(root, reason); root.prepend(ph); }
      hiddenRoots.set(root, ph);
    });
  }

  function unhideRoot(root) {
    selfWrite(() => {
      hiddenRoots.get(root)?.remove();
      root.removeAttribute("data-unbait-hide");
      hiddenRoots.delete(root);
    });
    // Overskrifter, der nåede at stå i kø, mens kortet var skjult, behandles forfra
    for (const el of [...tracked]) {
      const c = cards.get(el);
      if (root.contains(el) && c && c.showing !== "ai" && el.dataset.unbait === "pending") resetCard(el, false);
    }
  }

  function unhideAll() {
    for (const r of [...hiddenRoots.keys()]) unhideRoot(r);
    selfWrite(() => hiddenGroups.forEach(g => g.removeAttribute("data-unbait-hide")));
    hiddenGroups.clear();
    selfWrite(() => hiddenChasers.forEach(c => c.removeAttribute("data-unbait-hide")));
    hiddenChasers.clear();
  }

  // EB: plus-henvisninger under et kort ("+ Ejer stort palæ"). De fjernes altid helt (også ved
  // "tynd linje"), tæller ikke med i "skjult", og hovedkortet bliver stående. Er alle henvisninger
  // i boksen skjult, fjernes boksen også (v1.21).
  const hiddenChasers = new Set();
  function updateChasers() {
    if (SITE !== "eb") return;
    const on = enabled && hideCfg.plus;
    const set = (el, hide) => {
      if (hide === (el.getAttribute("data-unbait-hide") === "remove")) return;
      injectStyleOnce();
      selfWrite(() => hide ? el.setAttribute("data-unbait-hide", "remove") : el.removeAttribute("data-unbait-hide"));
      if (hide) hiddenChasers.add(el); else hiddenChasers.delete(el);
    };
    document.querySelectorAll(".dre-item__chasers").forEach(box => {
      const links = [...box.querySelectorAll("a.dre-item__chaser")];
      let all = links.length > 0;
      links.forEach(a => { const h = on && a.matches(".dre-item__chaser--badge-premium"); set(a, h); if (!h) all = false; });
      set(box, on && all);
    });
  }

  // EB: er alle kort i en gruppe skjult, skjules gruppen også, så der ikke står tomme rammer tilbage.
  // Det samme gælder karrusellerne: her skjules hele blokken med overskrift (v1.18).
  function updateGroups() {
    const groups = [];
    if (SITE === "eb") {
      document.querySelectorAll(".dre-group").forEach(g => groups.push([g, g.querySelectorAll(".dre-item")]));
      document.querySelectorAll(".horizontal-container").forEach(hc => {
        // Hele widgetten (den har en fast minimumshøjde), hvis den kun rummer denne karrusel
        const w = hc.closest("[id^='svelte-list-']");
        const g = w && w.querySelectorAll(".horizontal-container").length === 1 ? w : hc;
        groups.push([g, hc.querySelectorAll("a.list-item")]);
      });
    }
    if (SITE === "bt") {
      // BT's podcast-række: hele rækken med overskriften "PODCAST", når alle podcast-kort er skjult (v1.30)
      const rows = new Set([...document.querySelectorAll(BT_PODCAST)].map(a => a.closest(BT_PODCAST_ROW)).filter(Boolean));
      rows.forEach(r => groups.push([r, [...r.querySelectorAll(BT_PODCAST)].map(cardRoot)]));
    }
    if (SITE === "dr") {
      // DR: hele blokken "… lige nu"/"Seneste om …" med overskrift, når alle dens kort er skjult (v1.76)
      document.querySelectorAll(DR_MORE).forEach(b => groups.push([b, [...b.querySelectorAll("a.dre-teaser-title")].map(cardRoot)]));
    }
    if (!groups.length && !hiddenGroups.size) return;
    groups.forEach(([g, items]) => {
      const all = items.length > 0 && [...items].every(i => i.getAttribute("data-unbait-hide") === "remove");
      if (all && !hiddenGroups.has(g)) { selfWrite(() => g.setAttribute("data-unbait-hide", "remove")); hiddenGroups.add(g); }
      else if (!all && hiddenGroups.has(g)) { selfWrite(() => g.removeAttribute("data-unbait-hide")); hiddenGroups.delete(g); }
    });
  }

  const isHiddenEl = (el) => !!el.closest("[data-unbait-hide]");

  // ---------------------------------------------------------------------
  // Original og omskrivning. De oprindelige noder gemmes og sættes tilbage,
  // så sidens egne eventlyttere bevares (fund S05).
  // ---------------------------------------------------------------------
  function resetCard(el, restore) { selfWrite(() => resetCardInner(el, restore)); }
  function resetCardInner(el, restore) {
    const c = cards.get(el);
    if (c) {
      if (restore && c.nodes && c.showing === "ai") el.replaceChildren(...c.nodes);
      el.querySelector(".unbait-toggle")?.remove();
      if (c.jobId) chrome.runtime.sendMessage({ action: "cancelJob", jobId: c.jobId }).catch(() => {});
    }
    cards.delete(el);
    tracked.delete(el);
    excerptText.delete(el);   // v1.90 (audit A-02): et uddrag fra den forrige artikel må ikke skjule den nye
    delete el.dataset.unbait;
  }

  const KEEP_SIZE_MAX = 28;   // px – til og med denne skrift skrumpes omskrivningen ikke (v1.55)
  function applyRewrite(el, text) { selfWrite(() => applyRewriteInner(el, text)); }
  function applyRewriteInner(el, text) {
    const c = cards.get(el);
    if (!c) return;
    if (!c.nodes) c.nodes = [...el.childNodes];
    inserted.set(el, text);
    const rect = el.getBoundingClientRect();
    const boxW = rect.width, boxH = rect.height;

    // Find det element, der bærer teksten (største skrift) og kopier dets stil
    let src = el, maxFont = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.querySelectorAll("*").forEach(n => {
      const ownText = [...n.childNodes].some(t => t.nodeType === 3 && t.textContent.trim());
      if (!ownText) return;
      const f = parseFloat(getComputedStyle(n).fontSize);
      if (f > maxFont || src === el) { maxFont = Math.max(f, maxFont); src = n; }
    });
    const cs = getComputedStyle(src);
    const copy = ["fontFamily", "fontWeight", "fontStyle", "fontStretch", "color", "textTransform",
      "letterSpacing", "textShadow", "webkitTextStrokeWidth", "webkitTextStrokeColor", "textAlign"];
    const saved = {};
    copy.forEach(p => saved[p] = cs[p]);
    const bgColor = cs.backgroundColor, bgImage = cs.backgroundImage;
    const hasBg = (bgColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(bgColor)) || (bgImage && bgImage !== "none");
    const pad = cs.padding;

    const span = document.createElement("span");
    span.className = "unbait-text";
    span.style.cssText = "display:block; line-height:1.1; white-space:normal; overflow-wrap:normal; word-break:normal; hyphens:manual;";
    copy.forEach(p => { if (saved[p]) span.style[p] = saved[p]; });
    // v1.67: sidste ord og AI-ikonet står i ét element uden linjeskift, så ikonet aldrig ender alene på en linje.
    // En pladsholder i ikonets bredde regnes med, når skriftstørrelsen tilpasses; ikonet erstatter den bagefter.
    const cut = text.lastIndexOf(" ");
    const tail = document.createElement("span");
    tail.className = "unbait-tail";
    tail.style.cssText = "white-space:nowrap";
    tail.textContent = cut >= 0 ? text.slice(cut + 1) : text;
    const slot = document.createElement("span");
    slot.className = "unbait-slot";
    slot.style.cssText = "display:inline-block;width:24px;height:1px";
    tail.appendChild(slot);
    const head = cut >= 0 ? text.slice(0, cut + 1) : "";
    if (hasBg && src !== el) {
      const inner = document.createElement("span");
      inner.append(head, tail); // altid som tekst, aldrig som HTML
      inner.style.backgroundColor = bgColor;
      if (bgImage && bgImage !== "none") inner.style.backgroundImage = bgImage;
      inner.style.padding = pad;
      inner.style.boxDecorationBreak = "clone";
      inner.style.webkitBoxDecorationBreak = "clone";
      span.appendChild(inner);
    } else {
      span.append(head, tail);
    }
    el.replaceChildren(span);
    c.span = span;
    c.anchor = tail;

    // Almindelige kort (skrift op til 28 px) beholder sidens skriftstørrelse og linjeafstand; bliver teksten længere,
    // bliver kortet højere (v1.55). Kun store overskrifter, som siden selv tilpasser (fx EB's og B.T.'s topkort), skrumpes.
    if (maxFont <= KEEP_SIZE_MAX) { span.style.fontSize = maxFont + "px"; span.style.lineHeight = cs.lineHeight; return; }
    if (boxW < 20 || boxH < 10) return;
    span.style.width = boxW + "px";
    span.style.maxWidth = "100%";
    const fits = (px) => {
      span.style.fontSize = px + "px";
      return span.scrollWidth <= boxW + 1 && span.getBoundingClientRect().height <= boxH * 1.15;
    };
    let lo = 12, hi = Math.max(12, maxFont), best = lo;
    if (fits(hi)) best = hi;
    else for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) { best = mid; lo = mid; } else hi = mid;
    }
    span.style.fontSize = Math.floor(best) + "px";
  }

  // ---------------------------------------------------------------------
  // Skifteknap: unbAIt DK-ikonet (AI). Rødt = omskrevet, gråt = original. 18 px (v1.34).
  // Kan bruges med tastatur (Tab, Enter, Mellemrum) (fund S06).
  // ---------------------------------------------------------------------
  const ICON_ON = chrome.runtime.getURL("icons/on-48.png");
  const ICON_OFF = chrome.runtime.getURL("icons/off-48.png");

  let styleEl = null;
  function injectStyleOnce() {
    if (styleEl?.isConnected) return;
    if (styleEl) { (document.head || document.documentElement).appendChild(styleEl); return; }   // fjernet af siden (v1.40)
    const st = styleEl = document.getElementById("unbait-style") || document.createElement("style");
    if (st.isConnected) return;
    st.id = "unbait-style";
    st.textContent = ".unbait-toggle:focus-visible{outline:2px solid #2563eb !important;outline-offset:2px !important;border-radius:4px !important}" +
      // Skjulte historier: fjernet helt, eller vist som en tynd linje, der kan klikkes frem
      "[data-unbait-hide='remove']{display:none !important}" +
      "[data-unbait-hide='dim']>:not(.unbait-ph){display:none !important}" +
      "[data-unbait-hide='dim']{min-height:0 !important;height:auto !important;aspect-ratio:auto !important;padding:0 !important;background:none !important;box-shadow:none !important;border:0 !important}" +
      ".unbait-ph{display:block !important;font:12px/1.4 system-ui,sans-serif !important;color:#6b7280 !important;background:#f3f4f6 !important;" +
      "border-radius:4px !important;padding:3px 8px !important;margin:2px 0 !important;cursor:pointer !important;text-align:left !important;" +
      "text-transform:none !important;letter-spacing:normal !important;font-style:normal !important;font-weight:400 !important}" +
      ".unbait-ph:focus-visible{outline:2px solid #2563eb !important}";
    (document.head || document.documentElement).appendChild(st);
  }

  function setToggleState(btn, showing) {
    const img = btn.firstChild;
    // v1.91: »Behold originalen« – ikonet står nedtonet, og højreklik (eller klik) giver »Omskriv alligevel«
    if (showing === "kept") {
      img.src = ICON_OFF; btn.style.setProperty("opacity", ".45", "important");
      btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-haspopup", "menu");
      const label = "unbAIt DK: originalen beholdes";
      btn.title = label; btn.setAttribute("aria-label", label);
      return;
    }
    btn.style.removeProperty("opacity"); btn.setAttribute("aria-haspopup", "menu");
    img.src = showing === "ai" ? ICON_ON : ICON_OFF;
    btn.setAttribute("aria-pressed", showing === "ai" ? "true" : "false");
    const label = showing === "ai" ? "unbAIt DK: vis original overskrift" : "unbAIt DK: vis omskrevet overskrift";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function createToggle(el) { selfWrite(() => createToggleInner(el)); }
  function createToggleInner(el) {
    injectStyleOnce();
    el.querySelector(".unbait-toggle")?.remove();
    const btn = document.createElement("span");
    btn.className = "unbait-toggle";
    btn.setAttribute("role", "button");
    btn.tabIndex = 0;
    btn.style.cssText = `
      display:inline-flex !important; align-items:center !important; justify-content:center !important;
      width:21px !important; height:21px !important; min-width:0 !important; max-width:none !important;   /* v1.63: klikområde 21×21, ikonet stadig 18×18 */
      margin:0 0 0 3px !important; padding:0 !important; cursor:pointer; font-size:12px !important;
      line-height:1 !important; vertical-align:middle !important; background:none !important;
      position:relative !important; z-index:2147483646 !important; float:none !important;   /* v1.57: over sidens usynlige klik-lag (EB/B.T.) */
    `;
    const img = document.createElement("img");
    img.alt = "";
    img.style.cssText = "width:18px !important;height:18px !important;max-width:none !important;min-width:0 !important;margin:0 !important;padding:0 !important;border:0 !important;display:block !important;position:static !important;object-fit:contain !important;pointer-events:none";
    btn.appendChild(img);
    setToggleState(btn, cards.get(el)?.kept ? "kept" : "ai");

    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation(); // knappen ligger ofte inde i et link
      flushPending();      // sidens ventende ændringer først – kortet kan være nulstillet af dem
      const c = cards.get(el);
      if (!c || !el.contains(btn)) return;
      if (c.kept || !c.rewritten) { openCardMenu(el, btn); return; }   // v1.91: intet at skifte til – menuen i stedet
      c.showing = c.showing === "ai" ? "original" : "ai";
      selfWrite(() => {
        if (c.showing === "ai") applyRewriteInner(el, c.rewritten);
        else el.replaceChildren(...c.nodes);
        placeToggle(c, el, btn);
        setToggleState(btn, c.showing);
      });
      btn.focus({ preventScroll: true });
    };
    btn.addEventListener("click", toggle);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
      // v1.91: menuen også fra tastaturet (menu-tasten eller Shift+F10)
      else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); e.stopPropagation(); openCardMenu(el, btn); }
    });
    // v1.91: højreklik på ikonet åbner unbAIt DK's lille menu (Prøv igen / Behold originalen / Omskriv alligevel)
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); openCardMenu(el, btn); });
    btn.addEventListener("mousedown", (e) => { if (e.button === 2) e.stopPropagation(); });
    placeToggle(cards.get(el), el, btn);
  }
  // Ikonet sættes efter sidste ord (i stedet for pladsholderen) eller, ved originalen, sidst i overskriften (v1.67)
  function placeToggle(c, el, btn) {
    if (c.showing === "ai" && c.anchor && c.span?.contains(c.anchor)) {
      c.anchor.querySelector(".unbait-slot")?.remove();
      c.anchor.appendChild(btn);
    } else (c.showing === "ai" && c.span ? c.span : el).appendChild(btn);
  }

  // ---------------------------------------------------------------------
  // Uddragets størrelse: højst EXCERPT_MAX tegn i alt; brødteksten fra strukturerede data højst BODY_MAX; er der allerede
  // ENOUGH tegn fra beskrivelserne, hentes ingen brødtekst
  const EXCERPT_MAX = 1500, BODY_MAX = 1200, ENOUGH = 600;
  // Artikel-uddrag (fund 06): kun tekst, der med rimelig sikkerhed tilhører
  // den aktuelle artikel. Kan det ikke afgøres, bruges intet uddrag.
  // ---------------------------------------------------------------------
  function samePage(a, b) {
    const n = (u) => pagePath(u, location.href);   // samme regel som cache-nøglen i baggrunden (shared.js, v1.97)
    // Samme domæne og samme artikelnummer er samme artikel, selv om teksten i adressen er ændret
    // (EB omdøber adresser: …/cigaretter-i-kufferterne/11326381 -> …/cigaretter-i-lufthavnen/11326381) (v1.20)
    const id = (u) => { try { const x = new URL(u, location.href); const m = x.pathname.match(/(?:\/|article)(\d{6,})(?:\.ece)?\/?$/);
      return m ? x.hostname.replace(/^www\./, "").toLowerCase() + "#" + m[1] : ""; } catch { return ""; } };
    return !!((n(a) && n(a) === n(b)) || (id(a) && id(a) === id(b)));
  }

  // Teksten i artiklens adresse, til brug når der intet uddrag er (v1.20), eller uddraget er kort (v1.30).
  // Fx …/krimi/taget-med-naesten-100.000-cigaretter-i-kufferterne/11326381 -> "taget med naesten 100.000 cigaretter i kufferterne"
  function urlText(url) {
    try {
      const segs = new URL(url).pathname.split("/").filter(Boolean).map(s => decodeURIComponent(s));
      for (let i = segs.length - 1; i >= 0; i--) {
        let s = segs[i].replace(/\.(ece|html?)$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
        if (!/[a-zæøå]/i.test(s) || s.split("-").length < 3) continue;   // fx "11326381", "article11325528", "krimi"
        return s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
      }
    } catch {}
    return "";
  }

  const BODY_SELECTORS = {
    eb: ["[itemprop='articleBody']", ".article-bodytext", "[class*='article-body']", "[class*='bodytext']"],
    // De nye sider (v1.37) bruger GENERIC_BODY nedenfor
    bt: ["[itemprop='articleBody']", "[class*='ArticleBody']", "[class*='article-body']", "[class*='bodytext']"],
    tv2: ["[itemprop='articleBody']", ".tc_richcontent", "[class*='article__body']", "[class*='article-body']"]
  };
  const GENERIC_BODY = ["[itemprop='articleBody']", "[class*='article-body']", "[class*='ArticleBody']", "[class*='articleBody']",
    "[class*='article__body']", "[class*='bodytext']", "[class*='article-content']", "article"];
  const NOT_BODY = "aside, nav, footer, figure, figcaption, [class*='related'], [class*='relateret'], [class*='teaser'], [class*='Teaser'], [class*='recommend'], [class*='anbefal'], [class*='list'], [class*='paywall'], [class*='newsletter'], [class*='nyhedsbrev']";

  // descOnly: kun sidens beskrivelse (live-sider, hvor brødteksten er liveindlæg) (v1.23)
  // finalUrl (v1.67): adressen, serveren omdirigerede til (fx B.T.: …/fyrer-123 -> …/nu-er-det-besluttet-fyrer-123)
  function extractExcerpt(html, articleUrl, descOnly = false, finalUrl = "") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Siden skal være den artikel, vi bad om (ikke fx en login- eller forside efter omdirigering)
    const canonLink = doc.querySelector("link[rel='canonical']")?.href;
    const ogUrl = doc.querySelector("meta[property='og:url']")?.content;
    let canonical = canonLink || ogUrl;
    // Omdirigeret af sidens egen server til en artikel på samme domæne, som siden selv oplyser som sin adresse:
    // så er det den rigtige artikel. En forside eller login-side godtages ikke (skal være markeret som artikel).
    if (finalUrl && canonical && !samePage(canonical, articleUrl) && samePage(canonical, finalUrl)) {
      try {
        const a = new URL(articleUrl, location.href), f = new URL(finalUrl, location.href);
        const isArticle = /^article$/i.test(doc.querySelector("meta[property='og:type']")?.content || "") ||
          [...doc.querySelectorAll('script[type="application/ld+json"]')].some(x => /"@type"\s*:\s*\[?\s*"(News|Report)?Article"/.test(x.textContent));
        if (f.hostname === a.hostname && f.pathname.replace(/\/+$/, "") !== "" && isArticle) articleUrl = f.href;
      } catch {}
    }
    if (canonical && !samePage(canonical, articleUrl)) {
      // TV 2's regionale artikler: canonical peger på et andet domæne (fx tvsyd.dk), men
      // og:url passer præcis med linket. Så er det den rigtige artikel (v1.23).
      const host = (u) => { try { return new URL(u, location.href).hostname.replace(/^www\./, ""); } catch { return ""; } };
      // TV 2's live-sider: linket peger på et bestemt indlæg (?entry=…), og siden svarer med
      // indlæggets egen adresse under samme liveblog: …/<liveblog>/<indlæg>?entry=… (v1.26)
      const sameEntry = (() => {
        try {
          const a = new URL(articleUrl, location.href), c = new URL(canonical, location.href);
          const e = a.searchParams.get("entry");
          if (!e || c.searchParams.get("entry") !== e) return false;
          if (a.hostname !== "nyheder.tv2.dk" || c.hostname !== a.hostname || !/^\/live\//.test(a.pathname)) return false;
          const ap = a.pathname.replace(/\/+$/, "");
          return c.pathname === ap || c.pathname.startsWith(ap + "/");
        } catch { return false; }
      })();
      if (sameEntry) { /* godkendt */ }
      else if (canonLink && ogUrl && samePage(ogUrl, articleUrl) && host(canonLink) !== host(articleUrl)) canonical = ogUrl;
      else return "";
    }

    const parts = [];
    const add = (t) => {
      t = (t || "").replace(/\s+/g, " ").trim();
      if (t.length < 30) return;
      if (siteDescriptions().has(t)) return;   // mediets generelle beskrivelse er ikke et uddrag (v1.19)
      if (/cookie|abonnement|log ind|annonce|del artiklen|læs også/i.test(t)) return;
      if (parts.some(p => p.includes(t) || t.includes(p))) return;
      parts.push(t);
    };

    // 1) Strukturerede data: kun Article/NewsArticle, der passer til adressen
    const articles = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const walk = (o) => {
          if (!o || typeof o !== "object") return;
          if (Array.isArray(o)) return o.forEach(walk);
          const types = [].concat(o["@type"] || []);
          if (types.some(t => /Article$/i.test(t))) articles.push(o);
          if (o["@graph"]) walk(o["@graph"]);
        };
        walk(JSON.parse(s.textContent));
      } catch {}
    });
    const idOf = (a) => {
      const u = a.url || a.mainEntityOfPage?.["@id"] || a.mainEntityOfPage || a["@id"];
      return typeof u === "string" && /^https?:|^\//.test(u) ? u : "";
    };
    // Objekter med en adresse bruges KUN, hvis adressen er den ønskede artikel (R01).
    // Et objekt uden adresse bruges kun, hvis det er det eneste, og siden selv (canonical) er bekræftet.
    const matching = articles.filter(a => idOf(a) && samePage(idOf(a), articleUrl));
    const anonymous = articles.filter(a => !idOf(a));
    const chosen = matching.length ? matching
      : (canonical && articles.length === 1 && anonymous.length === 1 ? anonymous : []);
    chosen.forEach(a => { add(a.description); if (a.articleBody && !descOnly) add(String(a.articleBody).slice(0, BODY_MAX)); });

    // 2) Sidens beskrivelse – kun når siden bekræftet er artiklen
    if (canonical) add(doc.querySelector('meta[property="og:description"]')?.content);
    // EB's live-artikler har kun underrubrikken her (og:description er blot "Læs mere her") (v1.19)
    if (canonical) add(doc.querySelector('meta[name="description"]')?.content);

    // 3) Brødtekst fra artikelens egen tekstblok – ikke relaterede bokse
    if (!descOnly && parts.join(" ").length < ENOUGH) {
      let body = null;
      for (const sel of BODY_SELECTORS[SITE] || GENERIC_BODY) { body = doc.querySelector(sel); if (body) break; }
      body?.querySelectorAll("p").forEach(p => {
        if (p.closest(NOT_BODY)) return;
        if (parts.join(" ").length < EXCERPT_MAX) add(p.textContent);
      });
    }
    return parts.join("\n").slice(0, EXCERPT_MAX);
  }

  // Forsidens egne beskrivelser = mediets generelle tekst ("Danmarks største nyhedssite …")
  let siteDesc = null;
  function siteDescriptions() {
    if (!siteDesc) siteDesc = new Set([...document.querySelectorAll('meta[property="og:description"], meta[name="description"]')]
      .map(m => (m.content || "").replace(/\s+/g, " ").trim()).filter(Boolean));
    return siteDesc;
  }

  // EB's podcast-links (/podcast/#/episode/<podcast>/<episode>): siden bygges først i browseren,
  // så den hentes ikke. Podcastens navn og episodens titel tages fra adressen (v1.19).
  function podcastContext(url) {
    try {
      const u = new URL(url);
      if (!/^\/podcast\/?$/.test(u.pathname)) return null;
      const m = u.hash.match(/^#\/episode\/([^/]+)\/([^/?#]+)/);
      if (!m) return "";
      const words = (x) => decodeURIComponent(x).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      return `Podcast: ${words(m[1])}. Episode: ${words(m[2])}`;
    } catch { return null; }
  }

  // Mærkatet på kortet ("chok-sag", "nyt afsnit af 'redlight'") – på EB (v1.19) og fra v1.37 også
  // Se og Hør og Billed-Bladet, der er bygget på samme måde. "Lige nu" er ikke et mærkat.
  function cardLabel(el) {
    if (!DRE_SITE) return "";
    const h = el.closest(".dre-item")?.querySelector(".dre-item__header .dre-repeat");
    const t = (h?.textContent || "").replace(/\s+/g, " ").trim();
    if (/^lige nu$/i.test(t)) return "";
    return t.length >= 2 && t.length <= 80 ? t : "";
  }

  function withTimeout(p, ms, fallback) {
    let t;
    return Promise.race([p, new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
  }

  // Se og Hørs liveblog bygges i browseren af Norkon Live Center, så indlægget står ikke i
  // sidens HTML. Linket (?p=lc-<id>) peger på et bestemt indlæg; kanal og tenant står i sidens
  // Nuxt-data som "livecenter","<kanal>","<tenant>". Indlægget hentes fra Norkons feed (v1.39).
  const LC_FEED = "https://livecentercdn.norkon.net/BulletinFeed/";
  const LC_MAX_EARLIER = 3;
  function liveCenterPostId(url) {
    if (SITE !== "seoghoer") return "";
    try {
      const m = (new URL(url, location.href).searchParams.get("p") || "").match(/^lc-(\d+)$/);
      return m ? m[1] : "";
    } catch { return ""; }
  }
  function liveCenterChannel(html) {
    const m = (html || "").match(/"livecenter","(\d+)","([A-Za-z0-9_-]+)"/);
    return m ? { channel: m[1], tenant: m[2] } : null;
  }
  function liveCenterText(post) {
    const doc = new DOMParser().parseFromString(post?.content?.html || "", "text/html");
    doc.querySelectorAll("ncpost-content, script, style, blockquote, iframe").forEach(n => n.remove());
    const blocks = [...doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li")]
      .map(n => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    const body = blocks.length ? blocks.join(" ") : (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
    const title = String(post?.title || "").replace(/\s+/g, " ").trim();
    return [title, body].filter(Boolean).join("\n").slice(0, 1500);
  }
  async function fetchJson(url, ms) {
    try { const { res, raw } = await fetchWithTimeout(url, { credentials: "omit" }, ms); return res.ok ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  async function liveCenterContext(html, postId) {
    const lc = liveCenterChannel(html);
    if (!lc) return "";
    const base = LC_FEED + encodeURIComponent(lc.tenant) + "/" + encodeURIComponent(lc.channel) + "/";
    let data = await fetchJson(base + "Initial/", FEED_TIMEOUT_MS);
    for (let i = 0; data && data.success !== false; i++) {
      const res = data.result || {};
      const posts = [].concat(res.addedOrChanged || [], res.bulletins || []);
      const hit = posts.find(p => String(p?.id) === postId);
      if (hit) return liveCenterText(hit);
      const ids = posts.map(p => Number(p?.id)).filter(n => n > 0);
      // Indlæggene kommer nyeste først; er det ønskede nyere end det ældste hentede, findes det ikke
      if (!res.hasMore || !ids.length || i >= LC_MAX_EARLIER || Number(postId) > Math.min(...ids)) return "";
      data = await fetchJson(base + "EarlierObj/" + Math.min(...ids) + "/", FEED_TIMEOUT_MS);
    }
    return "";
  }

  // v1.68: TV 2's liveblogs uden ?entry= (fx forsidens kort, der linker til hele »Kort nyt«): indlægget findes ud fra
  // overskriften. Store og små bogstaver, mellemrum, anførselstegn og afsluttende tegn tæller ikke. Findes intet indlæg, bruges intet
  // uddrag – liveblog'ens generelle beskrivelse (»TV 2 serverer et kort og præcist overblik …«) bruges ikke.
  // Sammenligningen (headlineKey) står i shared.js (v1.94)
  function tv2LivePost(html, articleUrl, headline) {
    const want = headlineKey(headline);
    if (!want) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Siden skal være den liveblog, kortet linker til
    const canonical = doc.querySelector("link[rel='canonical']")?.href || doc.querySelector("meta[property='og:url']")?.content;
    if (!canonical || !samePage(canonical, articleUrl)) return "";
    for (const post of doc.querySelectorAll("article.tc_post")) {
      const title = post.querySelector(".tc_post__body__title");
      if (!title || headlineKey(title.textContent) !== want) continue;
      const body = post.querySelector(".tc_post__body__post .tc_richcontent");
      if (!body) return "";
      const ps = [...body.querySelectorAll("p")].map(p => p.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      return (ps.length ? ps.join("\n") : body.textContent.replace(/\s+/g, " ").trim()).slice(0, 1500);
    }
    // v1.79: en selvstændig live-artikel (fx nyheder.tv2.dk/live/udland/2026-11-02-frysere-…) er selve historien: er sidens
    // egen titel den samme som kortets overskrift, bruges sidens beskrivelse. »Kort nyt« har titlen »Kort nyt«, så den
    // generelle tekst bruges stadig aldrig
    const titles = [doc.querySelector("meta[property='og:title']")?.content || "", doc.querySelector("title")?.textContent || ""];
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { const j = JSON.parse(s.textContent); for (const x of [].concat(j)) if (x && x.headline) titles.push(String(x.headline)); } catch {}
    }
    const same = titles.some(t => headlineKey(t) === want || headlineKey(t.replace(/\s*[|–-]\s*TV ?2.*$/i, "")) === want);
    if (!same) return "";
    const desc = doc.querySelector("meta[property='og:description']")?.content || doc.querySelector("meta[name='description']")?.content || "";
    return desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
  }

  // v1.94: artikel på samme domæne som siden hentes direkte (højst ARTICLE_TIMEOUT_MS, højst ARTICLE_MAX_CHARS tegn);
  // finalUrl = adressen efter en omdirigering. Fejler hentningen, kastes fejlen videre til getContext (fetchWithTimeout i shared.js)
  async function fetchSameOrigin(url) {
    const { res, raw } = await fetchWithTimeout(url, { credentials: "include" }, ARTICLE_TIMEOUT_MS);
    if (!res.ok) return { html: "", finalUrl: "" };
    return { html: raw.slice(0, ARTICLE_MAX_CHARS), finalUrl: res.redirected ? res.url : "" };
  }

  async function getContext(url, headline = "") {
    if (!url) return "";
    const pod = podcastContext(url);
    if (pod !== null) return pod;
    const lcPost = liveCenterPostId(url);
    if (lcPost) {
      try {
        if (new URL(url, location.href).origin !== location.origin) return "";
        const { html } = await fetchSameOrigin(url);
        return await liveCenterContext(html, lcPost);   // ingen generisk liveblog-tekst som før
      } catch { return ""; }
    }
    // TV 2's live-sider (nyheder.tv2.dk/live/…) hentes, men kun beskrivelsen bruges (v1.23)
    const tv2Live = /^https?:\/\/nyheder\.tv2\.dk\/live\//i.test(url);
    // v1.68: uden ?entry= er linket hele liveblog'en – så findes indlægget ud fra overskriften
    const tv2Whole = tv2Live && (() => { try { return !new URL(url).searchParams.has("entry"); } catch { return false; } })();
    // v1.81: kun hele led i stien (/tv/, /video, /live?…); før ramte \b også fx /tv-2-erkender-fejl…
    if (!tv2Live && /\/(live|video|play|tv)(\/|$|[?#])|play\.tv2\.dk/i.test(url)) return "";
    try {
      let html = "", finalUrl = "";
      if (new URL(url).origin === location.origin) {
        ({ html, finalUrl } = await fetchSameOrigin(url));
      } else {
        const r = await withTimeout(chrome.runtime.sendMessage({ action: "fetchArticle", url }), ARTICLE_MSG_TIMEOUT_MS, null);
        html = r?.html || ""; finalUrl = r?.finalUrl || "";
      }
      if (!html) return "";
      return tv2Whole ? tv2LivePost(html, url, headline) : extractExcerpt(html, url, tv2Live, finalUrl);
    } catch { return ""; }
  }

  // ---------------------------------------------------------------------
  // Kø: kun synlige (eller næsten synlige) overskrifter, 4 ad gangen (fund 08)
  // ---------------------------------------------------------------------
  const pending = [];
  let running = 0;
  const MAX_PARALLEL = 4;

  function updateStatus() {
    if (!enabled) return;
    const left = pending.length + running;
    let msg = `Omskrevet ${processedCount}`;
    if (left) msg += ` · ${left} i kø`;
    if (hiddenRoots.size) msg += ` · ${hiddenRoots.size} skjult`;
    if (failCount) msg += ` · ${failCount} fejl`;
    showStatus(msg, { error: failCount > 0 && processedCount === 0, detail: failCount ? lastError : "" });
  }

  function distanceToViewport(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return 1e9;
    if (r.bottom < 0) return -r.bottom + 2000;
    if (r.top > innerHeight) return r.top - innerHeight;
    return -1;
  }

  function alive(job) {
    // Opgaven gælder stadig: samme runde, tændt, elementet findes, og det er samme artikel
    const c = cards.get(job.el);
    if (!(enabled && job.runId === runId && job.el.isConnected && c && c.jobToken === job.token)) return false;
    if (isHiddenEl(job.el)) return false;   // skjult historie: ingen AI-kald
    if (findArticleUrl(job.el) !== job.url) return false;
    return c.showing === "ai"
      ? !!c.span && job.el.contains(c.span) && c.span.textContent === c.rewritten
      : cleanText(job.el) === c.origText;
  }

  function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  }

  function pump() {
    while (enabled && running < MAX_PARALLEL && pending.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const d = distanceToViewport(pending[i].el);
        if (d < bd) { bd = d; bi = i; }
      }
      const job = pending.splice(bi, 1)[0];
      if (!alive(job)) continue;
      running++;
      runJob(job).finally(() => { running--; updateStatus(); pump(); });
    }
  }

  // ---------------------------------------------------------------------
  // v1.91: menuen på AI-ikonet (højreklik). Ligger i sin egen shadow DOM, så sidens stil ikke rammer den.
  // »Prøv igen« og »Omskriv alligevel« laver et nyt AI-kald uden om den gemte omskrivning og opdaterer alle
  // kort med samme historie. »Behold originalen« huskes i baggrunden; ikonet står så nedtonet.
  // ---------------------------------------------------------------------
  let menuHost = null;
  const MENU_CSS = `:host{all:initial}.m{position:fixed;z-index:2147483647;min-width:210px;padding:6px;background:#0F1116;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#E6E9EF;text-align:left}
button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:8px;background:none;color:#E6E9EF;cursor:pointer;font:inherit;margin:0}
button:hover,button:focus-visible{background:rgba(255,255,255,.08);outline:none}small{display:block;color:#8A93A3;font-size:12px;margin-top:2px}`;
  function closeCardMenu() { menuHost?.remove(); menuHost = null; }
  function openCardMenu(el, btn) {
    closeCardMenu();
    const c = cards.get(el);
    if (!c) return;
    const items = c.kept ? [["again", "Omskriv alligevel", "Ny omskrivning af artiklen"]]
      : [["retry", "Prøv igen", "Ny omskrivning – nyt AI-kald"], ["keep", "Behold originalen", "Omskriv ikke denne artikel igen"]];
    menuHost = document.createElement("unbait-menu");
    const root = menuHost.attachShadow({ mode: "open" });
    const st = document.createElement("style"); st.textContent = MENU_CSS;
    const m = document.createElement("div"); m.className = "m"; m.setAttribute("role", "menu");
    for (const [a, t, sub] of items) {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.dataset.a = a;
      b.append(t); const sm = document.createElement("small"); sm.textContent = sub; b.append(sm);
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeCardMenu(); cardAction(a, el); btn.focus({ preventScroll: true }); });
      m.append(b);
    }
    m.addEventListener("keydown", (e) => {
      const bs = [...m.querySelectorAll("button")], i = bs.indexOf(root.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeCardMenu(); btn.focus({ preventScroll: true }); }
      e.stopPropagation();
    });
    for (const ev of ["click", "mousedown", "pointerdown", "contextmenu"]) m.addEventListener(ev, (e) => e.stopPropagation());
    root.append(st, m);
    selfWrite(() => document.documentElement.appendChild(menuHost));
    const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
    m.querySelector("button")?.focus({ preventScroll: true });
  }
  addEventListener("pointerdown", (e) => { if (menuHost && !e.composedPath().includes(menuHost)) closeCardMenu(); }, true);
  addEventListener("scroll", () => closeCardMenu(), true);
  addEventListener("resize", () => closeCardMenu());
  addEventListener("keydown", (e) => { if (menuHost && e.key === "Escape") closeCardMenu(); }, true);

  // Alle kort på siden med samme historie (samme artikel og samme originale overskrift)
  function sameStory(el) {
    const c = cards.get(el);
    return c ? [...tracked].filter(x => { const o = cards.get(x); return o && x.isConnected && o.url === c.url && o.origText === c.origText; }) : [];
  }
  // v1.94: omskrivningen fjernes – originalen sættes tilbage (hvis den vises), AI-ikonet fjernes, og var kortet
  // omskrevet, tælles »Omskrevet« ned. Bruges af »Behold originalen« og når genkontrollen ikke gav en omskrivning
  function dropRewrite(el, c) {
    selfWrite(() => { if (c.showing === "ai" && c.nodes) el.replaceChildren(...c.nodes); el.querySelector(".unbait-toggle")?.remove(); });
    inserted.delete(el);
    if (c.rewritten) processedCount = Math.max(0, processedCount - 1);
    c.rewritten = null; c.showing = "original"; c.span = null; c.anchor = null;
  }
  function markKept(el) {
    const c = cards.get(el);
    if (!c) return;
    dropRewrite(el, c);
    c.kept = true; c.jobId = null;
    selfWrite(() => { el.dataset.unbait = "kept"; });
    createToggle(el);
  }
  function showRewrite(el, text) {
    const c = cards.get(el);
    if (!c) return;
    const wasAi = !!c.rewritten;
    if (c.kept || !c.rewritten) selfWrite(() => el.querySelector(".unbait-toggle")?.remove());
    c.kept = false; c.rewritten = text; c.showing = "ai";
    selfWrite(() => { el.dataset.unbait = "done"; });
    applyRewrite(el, text);
    createToggle(el);
    if (!wasAi) processedCount++;
  }
  async function cardAction(action, el) {
    const c = cards.get(el);
    if (!c || !enabled) return;
    const group = sameStory(el);
    if (action === "keep") {
      await chrome.runtime.sendMessage({ action: "keepOriginal", article: c.url, text: c.origText, keep: true }).catch(() => {});
      group.forEach(markKept); updateStatus(); return;
    }
    if (action === "again") await chrome.runtime.sendMessage({ action: "keepOriginal", article: c.url, text: c.origText, keep: false }).catch(() => {});
    showStatus(action === "again" ? "Omskriver igen…" : "Prøver igen…");
    let res;
    try {
      const context = await fetchContext(el, c);
      res = await requestRewrite(c, context, crypto.randomUUID(), true);
    } catch (e) { res = { error: e.message || String(e) }; }
    flushPending();
    if (!enabled) return;
    if (res && res.rewritten) {
      for (const x of group) if (cards.get(x)?.origText === c.origText && x.isConnected) showRewrite(x, res.rewritten);
      updateStatus(); return;
    }
    // Ingen godkendt omskrivning: den gamle bliver stående (»Prøv igen«); var originalen beholdt, er den ikke længere
    if (action === "again") for (const x of group) {
      const o = cards.get(x); if (!o) continue;
      o.kept = false; selfWrite(() => { x.querySelector(".unbait-toggle")?.remove(); x.dataset.unbait = "skipped"; });
    }
    updateStatus();
    showStatus((action === "again" ? "Omskriv alligevel" : "Prøv igen") + " gav ingen ny omskrivning" +
      (res?.error ? " (" + String(res.error).slice(0, 60) + ")" : res?.timeout ? " (AI svarede ikke i tide)" : ""), { error: !!res?.error });
  }

  // v1.94: fælles for den almindelige omskrivning og »Prøv igen«/»Omskriv alligevel«
  // Artiklens uddrag (højst 8 sekunder); huskes til »Skjul indhold« (egne ord tjekkes også i uddraget, v1.77) – men kun,
  // hvis opgaven stadig gælder (valid): et uddrag fra den forrige artikel må ikke skjule den nye (v1.90, audit A-02)
  async function fetchContext(el, c, valid = () => true) {
    const context = await withTimeout(getContext(c.url, c.origText), CONTEXT_TIMEOUT_MS, "");
    if (context && valid()) excerptText.set(el, context.toLowerCase());
    return context;
  }
  // Beder baggrunden om en omskrivning (højst 90 sekunder). Baggrunden afgør, om adressens tekst bruges
  function requestRewrite(c, context, jobId, force = false) {
    return withTimeout(chrome.runtime.sendMessage({ action: "rewrite", ...(force ? { force: true } : {}), text: c.origText, article: c.url, context,
      label: c.label, urlText: urlText(c.url), jobId }), REWRITE_TIMEOUT_MS, { timeout: true });
  }

  function applyResult(job, res) {
    flushPending();                  // en tekstændring, der lige er sket, skal ugyldiggøre opgaven nu
    if (!alive(job)) return;
    const { el } = job;
    const c = cards.get(el);
    c.jobId = null;
    if (!res || res.off) { el.dataset.unbait = "error"; if (!res) { failCount++; lastError = "intet svar"; } return; }
    if (res.error) {
      if (!res.error.includes("slukket")) { failCount++; lastError = res.error; }
      el.dataset.unbait = "error";
      return;
    }
    if (res.cancelled) { delete el.dataset.unbait; return; }   // v1.64: annulleret før kaldet startede
    if (res.kept) { markKept(el); return; }   // v1.91: »Behold originalen«
    if (res.skip) {
      // v1.90 (audit A-01): en gammel omskrivning (fra cachen) blev vist, men genkontrollen af artiklen gav ingen
      // godkendt omskrivning: originalen sættes tilbage, og AI-ikonet fjernes – også hvis brugeren viste originalen
      if (c.rewritten) dropRewrite(el, c);
      el.dataset.unbait = "skipped";
      return;
    }
    // Uændret efter tjek: intet ændres – heller ikke, hvis brugeren har klikket originalen frem (v1.94; før blev
    // omskrivningen vist igen og talt med to gange i »Omskrevet«)
    if (c.rewritten === res.rewritten) return;
    showRewrite(el, res.rewritten);
  }

  async function runJob(job) {
    const { el } = job;
    const c = cards.get(el);
    const jobId = crypto.randomUUID(); // unikt på tværs af faner (R03)
    c.jobId = jobId;
    try {
      const context = await fetchContext(el, c, () => alive(job));
      if (!alive(job)) return;
      // v1.77: står et af brugerens ord i uddraget, skjules kortet nu, og intet sendes til AI'en
      if (context && hideActive() && hideCfg.words.length) {
        const root = cardRoot(el);
        const reason = hideReasonFor(el, root);
        if (reason) { c.jobId = null; hideRoot(root, reason); updateGroups(); updateStatus(); return; }
      }
      const res = await requestRewrite(c, context, jobId);
      if (!alive(job)) return;
      if (res && res.timeout) {
        chrome.runtime.sendMessage({ action: "cancelJob", jobId }).catch(() => {});
        if ((job.timeouts || 0) < 2) {
          job.timeouts = (job.timeouts || 0) + 1;
          later(() => { if (alive(job)) { pending.push(job); updateStatus(); pump(); } }, RETRY_WAIT_MS);
          return;
        }
        applyResult(job, { error: "AI svarede ikke i tide" });
        return;
      }
      applyResult(job, res);
    } catch (e) {
      const m = e.message || String(e);
      if (/context invalidated/i.test(m)) {
        pending.length = 0;
        showStatus("Extensionen er opdateret – genindlæs siden", { error: true });
        return;
      }
      if (/message channel closed|Receiving end does not exist|Could not establish connection/i.test(m) && !job.retried) {
        job.retried = true;
        later(() => { if (alive(job)) { pending.push(job); pump(); } }, 1000);
        return;
      }
      if (!alive(job)) return;
      failCount++; lastError = m;
      el.dataset.unbait = "error";
    }
  }

  let tokenSeq = 0;
  async function processOne(el) {
    if (!enabled || !el.isConnected || isHiddenEl(el)) return;
    const text = cleanText(el);
    if (!looksLikeHeadline(text)) return;
    if (inserted.get(el) === text) return; // vores egen AI-tekst – afvent sidens rigtige overskrift
    if (noAIEl(el)) return; // BT's korte videoer (v1.30) og spil (v1.31) sendes ikke til AI'en
    const c = { url: findArticleUrl(el), origText: text, label: cardLabel(el), showing: "original", jobToken: ++tokenSeq };
    cards.set(el, c);
    tracked.add(el);
    selfWrite(() => { el.dataset.unbait = "pending"; });
    const job = { el, runId, token: c.jobToken, url: c.url };
    try {
      const res = await withTimeout(chrome.runtime.sendMessage({ action: "cached", text, article: c.url }), CACHED_TIMEOUT_MS, { miss: true });
      if (!alive(job)) return;
      if (res && !res.miss && !res.off) {
        applyResult(job, res);
        updateStatus();
        if (!res.stale) return;
        // Ældre end 2 timer: tjek i baggrunden, om artiklen er ændret
      }
    } catch {}
    if (!alive(job)) return;
    pending.push(job);
    updateStatus();
    pump();
  }

  // ---------------------------------------------------------------------
  // Find overskrifter, og hold øje med genbrugte nyhedskort (fund S03)
  // ---------------------------------------------------------------------
  function selector() {
    // Se og Hørs undersider (/kendte, /nyheder/viralt …) har små kort med billede, mærkat og overskrift:
    // <article><a href><…><h2>. Brugerens sider 24. okt. 2026 (v1.48)
    if (SITE === "seoghoer") return ".dre-item__title, article > a[href] h2";
    if (DRE_SITE) return ".dre-item__title";
    if (TEASER_SITE) return 'a[class*="TeaserLink"] h1, a[class*="TeaserLink"] h2, a[class*="TeaserLink"] h3, a[class*="TeaserLink"] [class*="itle"], a[class*="TeaserLink"]';
    // De nye sider (v1.37), fundet på brugerens forsider 22. okt. 2026
    // v1.76: DR's blok "Mere fra dr.dk" på artikelsiderne ("Indland lige nu", "Sport lige nu", "Seneste om kultur" …)
    // har a.dre-teaser-title i #hydra-more-news, ikke hydra-klasserne
    if (SITE === "dr") return "a.hydra-card-title, a.hydra-teaser-title, #hydra-more-news a.dre-teaser-title";
    if (SITE === "politiken") return 'a[href*="/art"] :is(h1, h2, h3, h4, h5)';
    // v1.95: JP's nye design (nov. 2026) – kortet er en <article> med et tomt link som lag over hele kortet og
    // overskriften ved siden af linket. Nyhedsoverblikket øverst har stadig overskriften inde i linket.
    if (SITE === "jp") return 'a[href*="/ECE"] :is(h1, h2, h3, h4), article:has(> a[href*="/ECE"]) :is(h1, h2, h3, h4)';
    if (SITE === "avisen") return "a.FrontpageBox .Header";
    // v1.80; v1.81: også boksen »Mest læste«; v1.96: også »Læs også« i artiklerne (h3.related-article__title i
    // a.related-article__link i article.related-article; boksen sættes ind af sidens script efter indlæsningen)
    if (JFM) return ".teaser__title, .list-article__title, .related-article__title";
    // v1.89: Y.dk – kun kort med et link (om overskriften eller som lag over kortet), ikke artikelsidens egen overskrift
    // v1.90: også de grå tekstkort uden billede (article.bg-surface-toggle), hvor overskriften står i et <p>.
    // Kun de grå kort – <p> i andre kort er underrubrikker
    if (YDK) return "article:has(> a[href]) :is(h1, h2, h3), a[href] :is(h1, h2, h3), article.bg-surface-toggle:has(> a[href]) > p";
    if (SITE === "nyheder24") return ".post-card .post-heading, a.recent-news-slider__item span.text-body-text";
    return ".tc_heading";
  }

  // Er et kendt kort blevet genbrugt til en anden artikel eller tekst af siden selv?
  function checkReuse(el) {
    const c = cards.get(el);
    if (!c) return;
    const urlChanged = findArticleUrl(el) !== c.url;
    const ourContentGone = c.showing === "ai" && (!el.contains(c.span) || c.span.textContent !== c.rewritten);
    const textChanged = c.showing !== "ai" && cleanText(el) !== c.origText;
    // v1.90 (audit A-02): kortet viser nu en anden artikel – brugerens »vis alligevel« gjaldt den forrige
    if (ourContentGone || textChanged || urlChanged) revealed.delete(cardRoot(el));
    if (ourContentGone || textChanged) {
      resetCard(el, false);          // siden har selv skrevet ny tekst – den skal ikke overskrives
    } else if (urlChanged) {
      // Kun linket er skiftet. Vores AI-tekst må ikke blive den nye artikels "original":
      // sidens egen originaltekst sættes tilbage og behandles som udgangspunkt (R02c)
      resetCard(el, c.showing === "ai");
    }
  }

  // v1.94: overskrifter, der venter på at komme i nærheden af skærmen. Scanningen læser ikke deres tekst igen
  // (det sker, når de kommer i syne – processOne tjekker den der)
  const waiting = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      waiting.delete(e.target);
      if (!cards.has(e.target)) processOne(e.target);
    }
  }, { rootMargin: "200% 0px" });  // to skærmhøjder frem: overskrifterne er klar, før man scroller ned til dem

  function scan() {
    if (!enabled) return;
    scanText = new Map();
    try { scanInner(); } finally { scanText = null; }
  }
  function scanInner() {
    // v1.90 (audit F-01): kort, som siden har fjernet, glemmes (og deres opgave annulleres), så de ikke fylder i hukommelsen
    for (const el of [...tracked]) if (!el.isConnected) resetCard(el, false);
    for (const el of waiting) if (!el.isConnected) { waiting.delete(el); io.unobserve(el); }
    const els = [...document.querySelectorAll(selector())];
    const fresh = [];
    // 1) Skal kortet skjules? Afgøres pr. kort (et kort kan have flere overskriftselementer).
    // EB's karruselkort og BT's podcast-kort vurderes også, men de omskrives ikke (de er ikke med i trin 2).
    const carousel = SITE === "eb" ? [...document.querySelectorAll(CAROUSEL_ITEM)]
      : SITE === "bt" ? [...document.querySelectorAll(BT_PODCAST)] : [];
    const decided = new Map();
    // v1.94: kendte kort tjekkes ikke igen her – det sker ved hver ændring på siden (touchedCards i handleMutations)
    for (const el of [...els, ...carousel]) {
      if (inExcludedRegion(el) || isOwn(el)) continue;
      const root = cardRoot(el);
      if (!decided.get(root)) decided.set(root, hideReasonFor(el, root));
    }
    // v1.92: EB's salgsbannere for Ekstra Bladet+ (iframe fra …/bannerhtml/data/PLUS/… eller klik-lag til /kampagner/…)
    // og Plus-salgsboksen nederst (.plus-footer) skjules under »Ekstra Bladet +« (brugerens ønske 8. nov. 2026)
    if (SITE === "eb") for (const box of ebPlusPromos())
      decided.set(box, hideActive() && hideCfg.plus && !revealed.has(box) ? "Ekstra Bladet+" : "");
    if (SITE === "avisen") for (const box of document.querySelectorAll(AVISEN_PARTNER))
      decided.set(box, hideActive() && hideCfg.adsAvisen && !revealed.has(box) ? "Annonce" : "");
    for (const [root, reason] of decided) {
      if (reason) hideRoot(root, reason);
      else if (hiddenRoots.has(root)) unhideRoot(root);
    }
    for (const r of [...hiddenRoots.keys()]) if (!r.isConnected) hiddenRoots.delete(r);
    updateGroups();
    updateChasers();
    if (hiddenRoots.size) updateStatus();
    // 2) Synlige overskrifter omskrives
    for (const el of els) {
      if (isHiddenEl(el)) continue;
      if (cards.has(el)) continue;
      if (waiting.has(el)) { fresh.push(el); continue; }   // venter allerede (v1.94)
      if (!isCandidate(el)) continue;
      if (noAIEl(el)) continue;      // BT's korte videoer (v1.30) og spil (v1.31) sendes ikke til AI'en
      if (!looksLikeHeadline(cleanText(el))) continue;
      fresh.push(el);
    }
    // Hvis både et element og et barn af det matcher, så brug kun barnet. v1.97 (M7): hvert element går op gennem sine
    // forældre én gang (før blev alle par sammenlignet – kvadratisk i antallet af overskrifter)
    const freshSet = new Set(fresh), hasChild = new Set();
    for (const el of fresh) for (let a = el.parentElement; a; a = a.parentElement) if (freshSet.has(a)) hasChild.add(a);
    fresh.filter(el => !waiting.has(el) && !hasChild.has(el)).forEach(el => { waiting.add(el); io.observe(el); });
    // v1.94: kun når siden slet ingen overskrifter har (heller ingen fejlede, afviste, beholdte eller skjulte) – ellers
    // bliver optællingen og en evt. fejlbesked stående (før: når intet var omskrevet, også hvis alle havde fejlet)
    if (!fresh.length && !tracked.size && !hiddenRoots.size && !pending.length && !running) showStatus("Fandt ingen overskrifter (endnu)");
  }

  // ---------------------------------------------------------------------
  // Tænd/sluk – fælles for alle faner via storage.sync (fund 02, 03, 04)
  // ---------------------------------------------------------------------
  function turnOff() {
    enabled = false;
    runId++;                               // alt igangværende arbejde er nu ugyldigt
    pending.length = 0;
    timers.forEach(clearTimeout); timers.clear();
    io.disconnect(); waiting.clear();
    unhideAll();                           // slukket: alt vises igen
    for (const el of [...tracked]) resetCard(el, true);
    processedCount = 0; failCount = 0; lastError = "";
    showStatus("Slukket");
  }

  function turnOn() {
    enabled = true;
    runId++;
    showStatus("Tændt – scanner…");
    scan();
  }

  // Observeren oprettes altid, så nye nyhedskort også fanges, hvis UnbaitDK tændes senere (fund 04).
  // Udvidelsens egne ændringer ignoreres, så statusboksen ikke udløser nye scanninger (fund S04).
  // v1.94: scanningen venter på 400 ms ro, men højst SCAN_MAX_WAIT efter den første ændring – ellers kørte den aldrig
  // på sider, der ændrer sig hele tiden (et ur, en ticker), og nye kort blev ikke fundet
  const SCAN_QUIET = 400, SCAN_MAX_WAIT = 1000;
  let scanTimer = null, scanDue = 0;
  function scheduleScan() {
    const now = Date.now();
    if (!scanDue) scanDue = now + SCAN_MAX_WAIT;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scanTimer = null; scanDue = 0; scan(); }, Math.max(0, Math.min(SCAN_QUIET, scanDue - now)));
  }
  // v1.94: de kendte kort, en række ændringer kan have rørt – fundet ud fra ændringerne, ikke ved at gennemgå alle kort:
  // ændringen er sket i kortet (samme område, som findArticleUrl finder linket i), inde i overskriften, på et link om
  // overskriften, eller kortet er sat ind på ny. Før blev alle kendte kort tjekket ved hver ændring – også ved et ur
  // uden for kortene. Fjernede kort glemmes ved næste scanning.
  const LINK_SCOPE = "article, [class*='teaser'], [class*='Teaser'], [class*='dre-item']";
  function touchedCards(mutations) {
    const out = new Set();
    const addIn = (root) => {
      if (!root) return;
      if (tracked.has(root)) out.add(root);
      for (const e of root.querySelectorAll("[data-unbait]")) if (tracked.has(e)) out.add(e);
    };
    for (const m of mutations) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!t?.isConnected) continue;
      addIn(t.closest(LINK_SCOPE));                                          // ændring i kortet
      const own = t.closest("[data-unbait]"); if (own && tracked.has(own)) out.add(own);   // ændring i overskriften
      if (m.type === "attributes") addIn(t);                                  // et link om overskriften har fået ny adresse
      if (m.type === "childList") for (const n of m.addedNodes) if (n.nodeType === 1) addIn(n);   // kort sat ind (igen)
    }
    return out;
  }
  // Siden har fjernet statusboksen eller udvidelsens stylesheet (fx DR, når sidens script overtager
  // siden): de sættes ind igen med det samme. Indsættelsen ignoreres af filteret nedenfor (v1.40).
  function restoreOwn() {
    if (statusEl && !statusEl.isConnected) (document.body || document.documentElement).appendChild(statusEl);
    if (styleEl && !styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
  }
  function handleMutations(mutations) {
    checkPath();                     // DR skifter side uden genindlæsning (v1.42)
    restoreOwn();
    if (!enabled) return;
    const relevant = mutations.some(m => {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (t?.closest?.("#unbait-status, #unbait-style")) return false;
      if (m.type === "attributes") return true;          // fx et link, der får ny href
      if (m.type === "characterData") return true;       // tekst ændret direkte i en tekstnode
      return ![...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.matches?.("#unbait-status, #unbait-style"));
    });
    if (!relevant) return;
    // Berørte kort tjekkes med det samme, så et forældet svar ikke kan nå at blive indsat;
    // den forsinkede scanning tager sig af nye kort og genbehandling (og tjekker alle kendte kort)
    for (const el of touchedCards(mutations)) checkReuse(el);
    scheduleScan();
  }
  // Navnet under tælleren i statusboksen (v1.75: »+ flere«, når puljen kan bruges)
  function refreshAiName() {
    chrome.runtime.sendMessage({ action: "getEnabled" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      aiName = res.model || "";
      if (statusEl && lastStatus) showStatus(lastMsg, { error: lastIsError, detail: lastDetail });   // v1.94: samme besked og farve som før
    });
  }
  // Baggrunden siger til, når nøglerne er ændret (dem kan indholdsscriptet ikke selv se)
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.action === "modelChanged") refreshAiName(); });
  mo = new MutationObserver(handleMutations);
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });

  chrome.storage.onChanged.addListener((changes, area) => {
    // v1.64: også modelskift hos OpenAI og OpenRouter (Gemini skifter udbyder med modellen)
    // v1.75: også puljen og nøglerne (»+ flere« efter modelnavnet)
    if (area === "sync" && (changes.provider || changes.openaiModel || changes.openrouterModel || changes.groqModel || changes.pool)) refreshAiName();
    if (area === "sync" && Object.keys(HIDE_DEFAULTS).some(k => changes[k])) {
      // Nye skjul-indstillinger gælder med det samme
      loadHideCfg().then(() => { if (!enabled) return; unhideAll(); scan(); updateStatus(); });
    }
    if (area !== "sync" || !(changes.enabled || changes.sites)) return;
    if (changes.enabled) globalOn = changes.enabled.newValue !== false;
    if (changes.sites) siteOn = siteEnabled(changes.sites.newValue);
    applyOnOff();
  });

  // Sider (v1.37): er fluebenet for denne side fjernet i indstillingerne, gør unbAIt DK intet her –
  // heller ingen statusboks. Det gælder også en side, der allerede er åben.
  // Det samme gælder DR's TV- og lydsider (pathOff, v1.42).
  let globalOn = false, siteOn = false, pathOff = offPath(), lastPath = location.pathname;
  // v1.91: pause pr. medie fra Chromes højrekliksmenu. Hver JFM-avis har sin egen nøgle (»jfm:fyens.dk«)
  const PAUSE = (() => {
    const s = UNBAIT_SITES.find(x => x.id === SITE);
    if (!s) return { key: "", name: "" };
    if (s.id !== "jfm") return { key: s.id, name: s.name };
    const h = location.hostname.toLowerCase(), d = siteDomains(s).find(d => h === d || h.endsWith("." + d)) || h;
    return { key: "jfm:" + d, name: d };
  })();
  let pausedHere = false;
  const reportIcon = () => chrome.runtime.sendMessage({ action: "tabIcon", paused: globalOn && siteOn && !pathOff && pausedHere }).catch(() => {});
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== "pauseChanged") return;
    const p = Array.isArray(msg.paused) && msg.paused.includes(PAUSE.key);
    if (p === pausedHere) return;
    pausedHere = p;
    if (started) applyOnOff();
  });
  function siteEnabled(list) { return (Array.isArray(list) ? list : DEFAULT_SITES).includes(SITE); }
  function removeStatus() { selfWrite(() => { statusEl?.remove(); statusEl = null; lastStatus = null; }); }
  function applyOnOff() {
    const here = siteOn && !pathOff;
    reportIcon();
    if (globalOn && here && !pausedHere) { if (!enabled) turnOn(); return; }
    closeCardMenu();
    if (enabled) turnOff();
    if (!here) removeStatus();
    else showStatus(globalOn && pausedHere ? `Pauset på ${PAUSE.name}` : "Slukket");   // v1.91
  }
  // Har siden skiftet adresse (uden genindlæsning) til eller fra DR's TV- og lydsider? (v1.42)
  let started = false;
  function checkPath() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const off = offPath();
    if (off === pathOff) return;
    pathOff = off;
    if (started) applyOnOff();
  }
  window.addEventListener("popstate", checkPath);

  chrome.runtime.sendMessage({ action: "getEnabled" }, (res) => {
    if (chrome.runtime.lastError) return;
    aiName = res?.model || "";
    globalOn = res?.enabled !== false;
    siteOn = siteEnabled(res?.sites);
    pausedHere = Array.isArray(res?.paused) && res.paused.includes(PAUSE.key);   // v1.91
    started = true;
    checkPath();
    reportIcon();
    if (!siteOn || pathOff) { loadHideCfg(); return; }
    if (globalOn && !pausedHere) {
      loadHideCfg().finally(() => { if (!globalOn || !siteOn || pathOff || pausedHere) return; turnOn(); later(scan, 1500); });
    } else {
      loadHideCfg();
      showStatus(globalOn && pausedHere ? `Pauset på ${PAUSE.name}` : "Slukket");
    }
  });
})();
