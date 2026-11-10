// Fælles værdier (v1.94: standardprompt, ordgrænser, udbydernavne m.m.) og fælles liste over siderne (v1.37)
importScripts("shared.js", "sites.js");

// Én fast model pr. udbyder – der er ikke en modelvælger.
// AWS Bedrock (Gemma 4) er fjernet i v1.50: brugeren har nedlagt sin AWS-konto.
const FIXED_MODELS = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-flash-latest",
  gemini_free: "gemini-3.5-flash-lite",
  // Groq: OpenAI-kompatibelt API, gratis niveau (v1.27)
  groq: "openai/gpt-oss-120b",
  // Amazon Nova 2 Lite via Amazons egen Nova-API (api.nova.amazon.com), gratis udviklerniveau (v1.38)
  nova_free: "nova-2-lite-v1",
  // OpenRouter (v1.51): brugeren vælger selv model i en ekstra liste (OPENROUTER_MODELS) – dette er standardvalget
  openrouter: "openrouter/free",
  // Kilo Code (v1.84): Kilos AI Gateway, gratis modeller uden nøgle (anonymt 200 kald/time pr. IP); Auto Free vælger selv en gratis model
  kilo: "kilo-auto/free",
  // v1.85: samme model med brugerens gratis Kilo-konto (nøgle) – egen udbyder som gemini/gemini_free, så nøgle og forbrug er for sig
  kilo_key: "kilo-auto/free",
  // DeepSeek: "deepseek-flash" køres af DeepSeek-V4.1-Flash-1017 (ifølge DeepSeeks API-dokumentation)
  deepseek: "deepseek-flash",
  // Chromes indbyggede model (Prompt API) – kører lokalt, ingen nøgle
  chrome_local: "gemini-nano"
};
const MODEL_NAMES = {
  openai: "GPT-6 Luna",
  anthropic: "Claude Haiku 5.5",
  gemini: "Gemini Flash Latest",
  gemini_free: "Gemini 3.5 Flash Lite (free tier - for development purposes only)",
  groq: "GPT-OSS 120B",
  nova_free: "Nova 2 Lite",
  openrouter: "Free Models Router",
  kilo: "Kilo Auto (free) · uden nøgle",
  kilo_key: "Kilo Auto (free) · med nøgle",
  deepseek: "DeepSeek-V4.1-Flash-1017",
  chrome_local: "Gemini Nano i Chrome (lokalt, eksperimentel)"
};

// ---- Log (v1.67): de samme beskeder som i konsollen, også i fanen "Log" i indstillingerne ----
// Gemmes i storage.session (ryddes, når browseren lukkes), højst 500 (v1.86; før 100). Ingen API-nøgler i beskederne.
const LOG_MAX = 500;
// v1.94: én hjælper til alle køer, hvor opgaverne skal køre én ad gangen (log, lokal AI, tællere, forbrug, sider, menu,
// »Behold originalen«). En fejl i én opgave stopper ikke de næste; den, der stillede opgaven, får fejlen.
function serialQueue() {
  let chain = Promise.resolve();
  return (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
}
const logQueue = serialQueue();
function logText(args) {
  return args.map(a => a instanceof Error ? a.message : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())
    .join(" ").replace(/^\[UnbaitDK\]\s*/, "");
}
// v1.74: navnet på den udbyder og model, der gav advarslen/fejlen (vises i loggen under ADVARSEL/FEJL)
const logModel = (s) => s && PROVIDER_NAMES[s.provider] ? PROVIDER_NAMES[s.provider] + " · " + modelNameFor(s) : "";
function ulog(level, ...args) { ulogM(level, "", ...args); }
function ulogM(level, model, ...args) {
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(...args);
  const entry = { t: Date.now(), level, msg: logText(args) };
  if (model) entry.model = model;
  logQueue(async () => {
    const { logEntries = [] } = await chrome.storage.session.get("logEntries");
    logEntries.push(entry);
    await chrome.storage.session.set({ logEntries: logEntries.slice(-LOG_MAX) });
  }).catch(() => {});
}

// OpenRouter (v1.51): de modeller, brugeren har valgt (id fra openrouter.ai, navn som brugeren skrev det).
// Gratis-modellerne (:free) og Free Models Router deler OpenRouters grænse for gratis kald.
const OPENROUTER_MODELS = [
  { id: "openrouter/free", name: "Free Models Router" },
  { id: "google/gemma-4-31b-it:free", name: "Google Gemma 4 31B (free)" },
  // v1.62: Nemotron 3 Super (free) fjernet (0 % oppetid hos NVIDIA siden 23. okt.); Lightning, Mistral og Flint tilføjet
  { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning (free)" },
  // Betalt model: OpenRouters grænse for gratis kald gælder ikke, og forbruget tælles for sig med prisen (PRICES)
  { id: "mistralai/mistral-small-24b-instruct-2501", name: "Mistral Small 3 (paid)", paid: true }
  // v1.63: Flint (free) fjernet – tænkende model, der brugte alle 2000 tokens på tænkning (tomme svar)
];
const openrouterModel = (id) => OPENROUTER_MODELS.find(m => m.id === id) || OPENROUTER_MODELS[0];
// OpenAI (v1.58): modellen vælges i en ekstra liste; GPT-6 Luna er standard
const OPENAI_MODELS = [
  { id: "gpt-6-luna", name: "GPT-6 Luna" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
  { id: "gpt-5.4-nano", name: "GPT-5.4 nano" }
];
const openaiModel = (id) => OPENAI_MODELS.find(m => m.id === id) || OPENAI_MODELS[0];
// Groq (v1.69): modellen vælges i listen "Model"; GPT-OSS 120B er standard. Hver model har sine egne gratis-grænser
// hos Groq (brugerens side Settings → Limits 27. okt.), så hver model får sin egen tæller (groqTier).
const GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
  { id: "qwen/qwen3.8-27b", name: "Qwen3.8 27B" }
];
const groqModel = (id) => GROQ_MODELS.find(m => m.id === id) || GROQ_MODELS[0];
// Udbydere med modelliste: den valgte model (ukendt/fjernet -> standardvalget)
const pickModel = (provider, id) => provider === "openrouter" ? openrouterModel(id) : provider === "openai" ? openaiModel(id)
  : provider === "groq" ? groqModel(id) : null;
// Navnet på den model, der bruges (statusboks og indstillinger)
const modelNameFor = (s) => pickModel(s.provider, s.model)?.name || MODEL_NAMES[s.provider] || "";
// Alle udbyderes modeller samlet ét sted (v1.67): indstillingerne viser én liste "Model" ud fra denne.
// value = det, listen gemmer; provider = den udbyder, valget betyder; model = modellens id (OpenAI/OpenRouter).
// Gemini: de to modeller er to udbydere (gemini/gemini_free) med hver sin nøgle og grænse.
// v1.94: hvert punkt har også sin tæller for gratis-grænser (tier, null = ingen), sin forbrugstæller (statsKey) og sit
// id i puljen (poolId), så indstillingssiden ikke selv skal regne dem ud
function modelGroups() {
  const item = (provider, model, name, extra = {}) => ({ value: model || provider, name, provider, ...(model ? { model } : {}), ...extra,
    tier: tierFor(provider, model), statsKey: statsKey(provider, model), poolId: poolId(provider, model) });
  const one = (p) => [item(p, "", MODEL_NAMES[p])];
  return {
    nova_free: one("nova_free"), anthropic: one("anthropic"), chrome_local: one("chrome_local"), deepseek: one("deepseek"),
    kilo: ["kilo", "kilo_key"].map(p => item(p, "", MODEL_NAMES[p])),   // v1.85: uden og med nøgle
    groq: GROQ_MODELS.map(m => item("groq", m.id, m.name)),
    gemini: ["gemini", "gemini_free"].map(p => item(p, "", MODEL_NAMES[p])),
    openai: OPENAI_MODELS.map(m => item("openai", m.id, m.name)),
    openrouter: OPENROUTER_MODELS.map(m => item("openrouter", m.id, m.name, { paid: !!m.paid }))
  };
}
// Forbrug tælles pr. OpenAI-model (v1.58); GPT-6 Luna beholder sin gamle tæller "openai"
// v1.62: også betalte OpenRouter-modeller tælles for sig ("openrouter:<id>"); de gratis deler "openrouter"
const statsKey = (provider, model) => provider === "openai" && openaiModel(model).id !== OPENAI_MODELS[0].id ? "openai:" + openaiModel(model).id
  : provider === "openrouter" && openrouterModel(model).paid ? "openrouter:" + openrouterModel(model).id
  : provider === "groq" && groqModel(model).id !== GROQ_MODELS[0].id ? "groq:" + groqModel(model).id : provider;   // v1.69

// ---- Pulje (v1.70): flere gratis modeller i prioriteret rækkefølge ----
// Kun modeller med egne gratis-grænser (tællere) kan indgå, for det er dem, unbAIt DK kan se er fyldt. id = "udbyder|model".
const poolId = (provider, model) => provider + "|" + (pickModel(provider, model)?.id || "");
function poolEntries() {
  const e = (provider, model, name, label) => ({ id: poolId(provider, model), provider, model: model || "", name: label + " · " + name });
  return [
    e("gemini_free", "", MODEL_NAMES.gemini_free, "Google Gemini"),
    ...GROQ_MODELS.map(m => e("groq", m.id, m.name, "Groq")),
    e("nova_free", "", MODEL_NAMES.nova_free, "Amazon Nova"),
    ...OPENROUTER_MODELS.filter(m => !m.paid).map(m => e("openrouter", m.id, m.name, "OpenRouter")),
    // v1.87: begge Kilo-varianter; uden nøgle kræver ingen nøgle
    e("kilo", "", MODEL_NAMES.kilo, "Kilo Code"),
    e("kilo_key", "", MODEL_NAMES.kilo_key, "Kilo Code")
  ];
}

// =====================================================================
// Chromes indbyggede AI (Prompt API / Gemini Nano) – eksperimentel
// Kører på computeren: gratis, ingen nøgle, intet sendes ud af huset.
// Dansk er ikke officielt understøttet (kun en, ja, es, de, fr), så vi beder om
// dansk, men falder tilbage til ingen sprogangivelse, hvis Chrome afviser det.
// LanguageModel bruges direkte i baggrunden; findes det ikke dér, bruges et
// skjult extension-dokument (offscreen), hvor det er tilgængeligt.
// =====================================================================
let localBase = null, localBasePrompt = null;
const localQueue = serialQueue();   // én lokal forespørgsel ad gangen

// Chromes modeltjeneste kan kortvarigt svare "unavailable" lige efter opstart – prøv én gang til
async function localAvailability() {
  const r = await localAvailabilityOnce();
  if (r.state !== "unavailable") return r;
  await new Promise(res => setTimeout(res, 1500));
  return localAvailabilityOnce();
}
// Dansk er ikke understøttet endnu: Chrome svarer "unavailable" (eller fejler) -> prøv uden sprogangivelse (shared.js)
async function localAvailabilityOnce() {
  if (typeof LanguageModel === "undefined") return viaOffscreen({ action: "localAvailability" });
  const { state, danish } = await localModelState();
  return { state, danish };
}

async function localPromptDirect(system, user, signal, retried = false) {
  if (!localBase || localBasePrompt !== system) {
    localBase?.destroy?.();
    localBase = null;
    const r = await createLocalSession(system);
    localBase = r.session;
    if (!localBase && !retried) {
      // Måske var modeltjenesten bare ikke klar endnu – prøv én gang til efter et øjeblik
      await new Promise(res => setTimeout(res, 1500));
      return localPromptDirect(system, user, signal, true);
    }
    if (!localBase) throw r.lastErr || new Error("Chromes indbyggede AI er ikke tilgængelig");
    localBasePrompt = system;
  }
  const s = await localBase.clone({ signal });   // ny samtale for hver overskrift
  try { return await s.prompt(user, { signal }); }
  finally { s.destroy?.(); }
}

let lastLocalMs = 0;   // svartid for seneste lokale kald (uden ventetid i køen) (v1.24)
function localPrompt(system, user, signal) {
  return localQueue(() => {
    if (signal?.aborted) throw new Error("aborted: slukket");
    const t0 = Date.now();
    return (typeof LanguageModel === "undefined"
      ? viaOffscreen({ action: "localPrompt", system, user }).then(r => { if (r.error) throw new Error(r.error); return r.text; })
      : localPromptDirect(system, user, signal)).finally(() => { lastLocalMs = Date.now() - t0; });
  });
}

async function viaOffscreen(msg) {
  if (!chrome.offscreen) return { state: "unavailable", error: "Chromes indbyggede AI er ikke tilgængelig i denne Chrome-version" };
  const url = chrome.runtime.getURL("local-ai.html");
  const exists = (await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] }))?.length;
  if (!exists) {
    try {
      await chrome.offscreen.createDocument({ url, reasons: ["WORKERS"], justification: "Kører Chromes indbyggede AI-model lokalt til omskrivning af overskrifter" });
    } catch (e) { if (!/single offscreen/i.test(e.message)) throw e; }
  }
  return chrome.runtime.sendMessage({ ...msg, target: "local-ai" });
}

// =====================================================================
// Indstillinger
// - Udbyder, prompt og tænd/sluk ligger i storage.sync (følger Chrome-kontoen).
// - API-nøgler ligger KUN i storage.local (synkroniseres ikke), og lageret er
//   begrænset til extensionens egne sider og baggrundsscriptet (fund 05).
// =====================================================================
try { chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }); } catch {}

async function getSettings() {
  const s = await chrome.storage.sync.get({ provider: "openai", prompt: DEFAULT_PROMPT, enabled: true,
    maxWordsFirst: MAX_WORDS_FIRST, maxWordsRetry: MAX_WORDS_RETRY, openrouterModel: "", openaiModel: "", groqModel: "", pool: [] });
  const { apiKeys = {} } = await chrome.storage.local.get("apiKeys");
  if (!FIXED_MODELS[s.provider]) s.provider = "openai"; // ukendt udbyder (fx fra en ændret sikkerhedskopi) -> standardvalget
  s.prompt = s.prompt || DEFAULT_PROMPT;
  s.apiKey = apiKeys[s.provider] || "";
  s.keys = apiKeys;   // v1.70: puljens modeller bruger deres egne nøgler
  s.pool = Array.isArray(s.pool) ? s.pool.filter(x => typeof x === "string") : [];
  // OpenRouter: den valgte model (ukendt eller fjernet model -> standardvalget). Modellen indgår i cache-nøglen.
  s.model = pickModel(s.provider, { openrouter: s.openrouterModel, openai: s.openaiModel, groq: s.groqModel }[s.provider])?.id || FIXED_MODELS[s.provider];
  // Brugerens egne ordgrænser (v1.22): 5–40, og andet forsøg aldrig under første
  const w = (x, d) => { x = parseInt(x, 10); return Number.isInteger(x) && x >= WORDS_MIN && x <= WORDS_MAX ? x : d; };
  s.maxWordsFirst = w(s.maxWordsFirst, MAX_WORDS_FIRST);
  s.maxWordsRetry = Math.max(w(s.maxWordsRetry, MAX_WORDS_RETRY), s.maxWordsFirst);
  return s;
}

async function isEnabled() {
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  return enabled !== false;
}

// =====================================================================
// Hash (SHA-256, fund S08) og cache-nøgler (fund 01 og 07)
// Nøglen består af artikelens adresse + overskrift + et fast øjebliksbillede af
// indstillingerne (prompt, udbyder, model). Uddragets hash gemmes i posten, så en
// opdateret artikel får en ny omskrivning.
// =====================================================================
async function sha(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

// v1.90 (audit A-05): parametre, der peger på et bestemt liveindlæg, er en del af artiklens identitet –
// TV 2 `?entry=<id>` og Se og Hør `?p=lc-<id>`. Andre parametre (fx sporing, y.dk's `?o=`) fjernes som før.
const ENTRY_PARAMS = [["entry", /^.+$/], ["p", /^lc-/i]];
function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const keep = ENTRY_PARAMS.map(([k, re]) => [k, u.searchParams.get(k)]).filter(([k, v], i) => v && ENTRY_PARAMS[i][1].test(v));
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase() +
      (keep.length ? "?" + keep.map(([k, v]) => k + "=" + v).join("&") : "");
  } catch { return ""; }
}

async function settingsSignature(s) {
  return sha(s.prompt + "|" + s.provider + "|" + s.model);
}

async function cacheKeyFor(article, text, sig) {
  return "c6_" + await sha(normalizeUrl(article) + "\n" + text + "\n" + sig);
}

// ---- Udløb: omskrevne overskrifter huskes i 30 dage, afviste svar i 1 dag ----
const DAY = 24 * 60 * 60 * 1000;
const TTL_OK = 30 * DAY, TTL_SKIP = 1 * DAY;
const REVALIDATE_AFTER = 2 * 60 * 60 * 1000; // efter 2 timer tjekkes artiklen for ændringer
const SKIP = "__unbait_skip__";

// Poster: { v: tekst, t: tidspunkt, x: uddragets hash }
function isExpired(e, now = Date.now()) {
  if (!e || typeof e !== "object") return true;
  return now - (e.t || 0) > (e.v === SKIP ? TTL_SKIP : TTL_OK);
}

async function readCache(key) {
  const r = await chrome.storage.local.get(key);
  const e = r[key];
  if (!e) return null;
  if (isExpired(e)) { chrome.storage.local.remove(key); return null; }
  return e;
}

async function writeCache(key, value, excerptHash) {
  const entry = { v: value, t: Date.now(), x: excerptHash };
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (e) {
    // Lageret er fuldt: ryd op og prøv igen – en fejl her må aldrig stoppe omskrivningen
    ulog("warn", "[UnbaitDK] Kunne ikke gemme i cachen – rydder op:", e);
    await cleanCache(true);
    try { await chrome.storage.local.set({ [key]: entry }); } catch {}
  }
}

// Fjerner udløbne svar. aggressive = lageret er fuldt.
async function cleanCache(aggressive = false) {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const remove = [], live = [];
  for (const [k, e] of Object.entries(all)) {
    if (!k.startsWith("c6_")) continue; // kun cache-nøgler
    if (isExpired(e, now)) remove.push(k); else live.push([k, e.t || 0]);
  }
  if (aggressive) {
    live.sort((a, b) => a[1] - b[1]);
    live.slice(0, Math.ceil(live.length / 2)).forEach(([k]) => remove.push(k));
  }
  if (remove.length) await chrome.storage.local.remove(remove);
  await chrome.storage.local.set({ lastCacheClean: now });
  if (remove.length) ulog("info", "[UnbaitDK] Cache ryddet:", remove.length, "fjernet");
}

// Tøm alle gemte omskrivninger (knap i indstillingerne). Nøgler og indstillinger bevares.
async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith("c6_"));
  if (keys.length) await chrome.storage.local.remove(keys);
  return { removed: keys.length };
}

async function maybeCleanCache() {
  const { lastCacheClean = 0 } = await chrome.storage.local.get("lastCacheClean");
  if (Date.now() - lastCacheClean > DAY) await cleanCache();
}

// =====================================================================
// Gratis Gemini: lokale, justerbare forbrugsgrænser (fund 09)
// Standard 15/minut, 500/dag og 250.000 tokens/minut (som Googles gratis-niveau for
// Gemini 3.5 Flash Lite; indtil v1.24 var tokengrænsen pr. dag). Det er UnbaitDK's egne
// grænser – Googles faktiske grænser afhænger af projektet. Alle tælleropdateringer
// køres én ad gangen, forventet forbrug reserveres, og minuttællingen gemmes, så
// den overlever genstart af baggrundsscriptet.
// =====================================================================
const DEFAULT_FREE_LIMITS = { rpm: 15, rpd: 500, tpm: 250000 };

// Udbydere med UnbaitDK's egne gratis-grænser (v1.27: også Groq – 30/minut, 1.000/dag, 8.000 tokens/minut)
function utcDay() { return new Date().toISOString().slice(0, 10); }
function pacificDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
const KILO_HOUR_MSG = (n) => `Timens Kilo-grænse er nået (${n} forespørgsler)`;
const GROQ_TOK_MSG = "Dagens tokens hos Groq er brugt – skift model eller vent til i morgen";   // brugerens tekst (v1.69)
const FREE_TIERS = {
  gemini_free: { limitsKey: "freeLimits", usageKey: "freeUsage", defaults: DEFAULT_FREE_LIMITS, day: pacificDay,
    dayMsg: (n) => `Dagens gratis Gemini-grænse er nået (${n} forespørgsler) – nulstilles ca. kl. 9` },
  // v1.69: også 200.000 tokens/dag (tpd) – den grænse rammer først. Gælder GPT-OSS 120B; de andre Groq-modeller nedenfor
  groq: { limitsKey: "groqLimits", usageKey: "groqUsage", defaults: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, day: utcDay,
    dayMsg: (n) => `Dagens Groq-grænse er nået (${n} forespørgsler)`, tokMsg: GROQ_TOK_MSG },
  // Amazon Nova 2 Lite (v1.38): 20 kald/minut og 500/dag ifølge nova.amazon.com. Der er ingen grænse for
  // tokens pr. minut (ingen tpm) – så tjekkes kun antal kald.
  nova_free: { limitsKey: "novaLimits", usageKey: "novaUsage", defaults: { rpm: 20, rpd: 500 }, day: utcDay,
    dayMsg: (n) => `Dagens Nova-grænse er nået (${n} forespørgsler)` },
  // OpenRouter (v1.51): gratis modeller har 20 kald/minut og 50/dag (1.000/dag med mindst 10 USD i kredit)
  // ifølge openrouter.ai/docs/api-reference/limits – fælles for alle gratis modeller. Ingen tokengrænse.
  openrouter: { limitsKey: "openrouterLimits", usageKey: "openrouterUsage", defaults: { rpm: 20, rpd: 50 }, day: utcDay,
    dayMsg: (n) => `Dagens OpenRouter-grænse er nået (${n} forespørgsler)` },
  // v1.87 (genskabt i v1.89): Kilo Code har kun en grænse pr. time, hver variant med sin egen tæller.
  // Målt: ca. 100 kald i timen uden nøgle og ca. 280–300 med nøgle. Ingen grænse pr. minut eller dag.
  kilo: { limitsKey: "kiloLimits", usageKey: "kiloUsage", defaults: { rph: 90 }, day: utcDay, hourMsg: KILO_HOUR_MSG },
  kilo_key: { limitsKey: "kiloKeyLimits", usageKey: "kiloKeyUsage", defaults: { rph: 250 }, day: utcDay, hourMsg: KILO_HOUR_MSG }
};

// v1.69: de øvrige Groq-modeller har hver sin tæller og sine egne grænser (samme tal som 120B hos Groq)
for (const m of GROQ_MODELS.slice(1)) FREE_TIERS["groq:" + m.id] = { ...FREE_TIERS.groq, limitsKey: "groqLimits:" + m.id, usageKey: "groqUsage:" + m.id };
// Tælleren for en udbyder + model (null = ingen gratis-grænser). Betalte OpenRouter-modeller er ikke omfattet (v1.62)
function tierFor(provider, model) {
  if (provider === "groq") return groqModel(model).id === GROQ_MODELS[0].id ? "groq" : "groq:" + groqModel(model).id;
  if (provider === "openrouter" && openrouterModel(model).paid) return null;
  return FREE_TIERS[provider] ? provider : null;
}

async function getFreeLimits(tier = "gemini_free") {
  const T = FREE_TIERS[tier];
  const got = (await chrome.storage.local.get(T.limitsKey))[T.limitsKey];
  return { ...T.defaults, ...(got || {}) };
}

// v1.69: skønnet over et kalds tokens (til minut- og dagsgrænsen) bygger hos Groq på de seneste kalds faktiske forbrug
// (tokens pr. tegn i prompt + besked, uden tokens fra cache) + 15 %. Før første kald: tegn ÷ 3 + 300 som før.
const tokPerChar = new Map();   // tier -> glidende gennemsnit
function estimateTokens(tier, chars) {
  const r = tier && tier.startsWith("groq") ? tokPerChar.get(tier) : null;
  return r ? Math.ceil(chars * r * 1.15) : Math.ceil(chars / 3) + 300;
}
function learnTokens(tier, chars, used) {
  if (!tier || !tier.startsWith("groq") || !(used > 0) || !(chars > 0)) return;
  const x = used / chars, old = tokPerChar.get(tier);
  tokPerChar.set(tier, old ? old * 0.7 + x * 0.3 : x);
}

const withUsageLock = serialQueue();

async function readUsage(tier = "gemini_free") {
  const T = FREE_TIERS[tier];
  const stored = (await chrome.storage.local.get(T.usageKey))[T.usageKey];
  const day = T.day();
  // Ny dag nulstiller dagstællerne, men minutvinduet fortsætter hen over midnat
  const u = stored && stored.day === day ? { ...stored } : { day, requests: 0, tokens: 0 };
  u.minute = (stored?.minute || []).filter(t => Date.now() - t < 61000);
  // Tokens i det seneste minut: [{ t: tidspunkt, n: tokens }] (v1.25)
  u.minuteTok = (stored?.minuteTok || []).filter(e => Date.now() - e.t < 61000);
  // v1.87: tidspunkterne for kaldene i den seneste time (Kilo Code)
  u.hour = (stored?.hour || []).filter(t => Date.now() - t < 3600000);
  return u;
}

function getFreeUsage(tier = "gemini_free") { return withUsageLock(() => readUsage(tier)); }

function adjustFreeTokens(delta, stamp, tier = "gemini_free") {
  return withUsageLock(async () => {
    const u = await readUsage(tier);
    u.tokens = Math.max(0, u.tokens + delta);
    const e = u.minuteTok.find(x => x.t === stamp);
    if (e) e.n = Math.max(0, e.n + delta);
    await chrome.storage.local.set({ [FREE_TIERS[tier].usageKey]: u });
  });
}

// v1.90: Kilo Code svarer 429, når dens egen grænse er nået, og spærringen varer op til en time.
// Den variant, der fik 429, holder pause i 15 minutter (brugerens valg 6. nov. 2026): med en reserve i puljen
// bruges reserven, ellers sendes intet til Kilo. Derefter prøves Kilo igen; giver den 429, kommer en ny pause.
// Pausen gemmes (kiloPause: { kilo: tidspunkt, kilo_key: tidspunkt }), så den overlever genstart af baggrundsscriptet.
// Gælder kun Kilo – de andre udbydere har ingen grænse pr. time.
const KILO_PAUSE_MS = 15 * 60000;
const isKiloTier = (tier) => tier === "kilo" || tier === "kilo_key";
const clockDK = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, "0") + "." + String(d.getMinutes()).padStart(2, "0"); };
// v1.91 (audit A-06, brugerens valg: mulighed 1): der er intet automatisk genforsøg, så teksten lover det ikke
const kiloPauseMsg = (until) => `Kilo-grænsen er nået – kan bruges igen kl. ${clockDK(until)}. Genindlæs siden for at prøve igen.`;
async function readKiloPause(tier) {
  const p = (await chrome.storage.local.get("kiloPause")).kiloPause || {};
  const until = Number(p[tier]) || 0;
  return until > Date.now() ? until : 0;
}
function setKiloPause(tier) {
  return withUsageLock(async () => {
    const p = { ...((await chrome.storage.local.get("kiloPause")).kiloPause || {}) };
    const until = Date.now() + KILO_PAUSE_MS;
    p[tier] = until;
    await chrome.storage.local.set({ kiloPause: p });
    ulog("warn", "[UnbaitDK] Kilo Code:", MODEL_NAMES[tier], "gav HTTP 429 – pause til kl.", clockDK(until));
    return until;
  });
}

// Ét forsøg på at få plads: { stamp } = reserveret, { wait } = vent så mange ms, { full } = dagsgrænsen er nået (fejl).
// v1.70: delt mellem freeTierGate (venter) og puljen (vælger en anden model i stedet for at vente)
function gateOnce(estimatedTokens, tier = "gemini_free") {
  return withUsageLock(async () => {
    // v1.90: Kilo holder pause efter 429 – som en fyldt grænse: puljen går videre, ellers vises beskeden
    if (isKiloTier(tier)) { const until = await readKiloPause(tier); if (until) return { full: new Error(kiloPauseMsg(until)) }; }
    const L = await getFreeLimits(tier);
    const u = await readUsage(tier);
    if (L.rpd && u.requests >= L.rpd) return { full: new Error(FREE_TIERS[tier].dayMsg(L.rpd)) };
    // v1.87: grænse pr. time (Kilo Code) – som dagsgrænsen: puljen går videre, ellers vises beskeden
    if (L.rph && u.hour.length >= L.rph) return { full: new Error(FREE_TIERS[tier].hourMsg(L.rph)) };
    // v1.69: tokens pr. dag (Groq). Tokens fra Groqs cache tæller ikke med (rettes efter hvert kald)
    if (L.tpd && u.tokens + estimatedTokens > L.tpd) return { full: new Error(FREE_TIERS[tier].tokMsg || "Dagens tokens er brugt") };
    if (L.rpm && u.minute.length >= L.rpm) return { wait: 61000 - (Date.now() - Math.min(...u.minute)) + 50 };
    // Tokens pr. minut: vent, til der er plads (et enkelt kald må altid komme igennem i et tomt minut)
    const tokMinute = u.minuteTok.reduce((a, e) => a + e.n, 0);
    if (L.tpm && u.minuteTok.length && tokMinute + estimatedTokens > L.tpm) return { wait: 61000 - (Date.now() - Math.min(...u.minuteTok.map(e => e.t))) + 50 };
    let now = Date.now();
    while (u.minuteTok.some(e => e.t === now)) now++;   // unikt tidsstempel til rettelsen bagefter
    u.minute.push(now);
    if (L.rph) u.hour.push(now);
    u.minuteTok.push({ t: now, n: estimatedTokens });
    u.requests += 1;
    u.tokens += estimatedTokens; // reservation – rettes til det faktiske forbrug bagefter
    await chrome.storage.local.set({ [FREE_TIERS[tier].usageKey]: u });
    return { stamp: now };
  });
}

// Venter på plads i minutvinduet og reserverer en forespørgsel + forventede tokens
async function freeTierGate(estimatedTokens, signal, tier = "gemini_free") {
  for (;;) {
    const r = await gateOnce(estimatedTokens, tier);
    if (r.full) throw r.full;
    if (r.stamp) return r.stamp;
    await sleep(r.wait, signal);
  }
}

function sleep(ms, signal) {
  // v1.90 (audit F-03): et signal, der allerede er afbrudt, afviser straks, og lytteren fjernes igen ved normal afslutning
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted: slukket")); return; }
    const onAbort = () => { clearTimeout(t); reject(new Error("aborted: slukket")); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// =====================================================================
// Eget forbrug pr. udbyder: kald og tokens fra hvert svar, uden udbyderens forsinkelse.
// Tokens ud tæller også modellens tænkning med, da den afregnes som output.
// =====================================================================
function usageFrom(provider, data) {
  const n = (x) => Number(x) || 0;
  // cached = den del af input, der kom fra udbyderens cache (afregnes billigere)
  if (provider === "anthropic") {
    const u = data.usage || {};
    return { input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
      cached: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens), output: n(u.output_tokens) };
  }
  if (isGemini(provider)) {
    const u = data.usageMetadata || {};
    return { input: n(u.promptTokenCount), cached: n(u.cachedContentTokenCount), output: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount) };
  }
  const u = data.usage || {};
  const cached = provider === "deepseek" ? n(u.prompt_cache_hit_tokens) : n(u.prompt_tokens_details?.cached_tokens);
  return { input: n(u.prompt_tokens), cached, output: n(u.completion_tokens) };
}

// ---- Anslået pris (v1.29): USD pr. million tokens. Gratis udbydere har ingen pris. ----
// Kilder: udbydernes prislister via tredjepartssider, 20. okt. 2026 (se overdragelsesnoten).
const PRICES = {
  openai: { in: 0.10, cache: 0.01, out: 0.50 },
  // v1.58: OpenAIs listepriser 26. okt. 2026 (developers.openai.com); gratis forbrug ved deling med OpenAI regnes ikke fra
  "openai:gpt-5.4": { in: 2.50, cache: 0.25, out: 15.00 },
  "openai:gpt-5.4-mini": { in: 0.75, cache: 0.075, out: 4.50 },
  "openai:gpt-5.4-nano": { in: 0.20, cache: 0.02, out: 1.25 },
  // v1.62: OpenRouters pris 26. okt. 2026 for Mistral Small 3 (ingen cache-rabat oplyst)
  "openrouter:mistralai/mistral-small-24b-instruct-2501": { in: 0.05, cache: 0.05, out: 0.08 },
  anthropic: { in: 0.10, cacheWrite: 0.125, cache: 0.01, out: 0.50 },
  gemini: { in: 0.75, cache: 0.075, out: 3.75 },
  deepseek: { in: 0.15, cache: 0.003, out: 0.60 }    // dobbelt pris i DeepSeeks dyre tidsrum
};
// DeepSeeks dyre tidsrum: isDeepseekPeak i shared.js
function costOf(provider, usage, when = new Date()) {
  const P = PRICES[provider];
  if (!P) return 0;
  const k = provider === "deepseek" && isDeepseekPeak(when) ? 2 : 1;
  const cached = usage.cached || 0, write = usage.cacheWrite || 0;
  const normal = Math.max(0, (usage.input || 0) - cached - write);
  return k * (normal * P.in + write * (P.cacheWrite ?? P.in) + cached * P.cache + (usage.output || 0) * P.out) / 1e6;
}

const withStatsLock = serialQueue();

function recordUsage(provider, usage) {
  return withStatsLock(async () => {
    const { tokenStats = {} } = await chrome.storage.local.get("tokenStats");
    const s = tokenStats[provider] || { calls: 0, input: 0, output: 0, since: Date.now() };
    s.calls += 1; s.input += usage.input; s.output += usage.output;
    s.cached = (s.cached || 0) + (usage.cached || 0);
    // Svartid: summen og antal målte kald (ældre tællere har ingen målinger) (v1.24)
    if (usage.ms > 0) { s.ms = (s.ms || 0) + usage.ms; s.timed = (s.timed || 0) + 1; }
    // Genforsøg (andet forsøg efter en afvisning) og anslået pris for alle kald (v1.29)
    s.retries = (s.retries || 0) + (usage.retry ? 1 : 0);
    s.cost = (s.cost || 0) + costOf(provider, usage);
    s.ok = s.ok || 0;
    tokenStats[provider] = s;
    await chrome.storage.local.set({ tokenStats });
  }).catch(e => console.warn("[UnbaitDK] Kunne ikke gemme forbrug:", e));
}

// En godkendt omskrivning fra AI'en (ikke fra UnbaitDK's cache) (v1.29)
function recordApproved(provider) {
  return withStatsLock(async () => {
    const { tokenStats = {} } = await chrome.storage.local.get("tokenStats");
    const s = tokenStats[provider];
    if (!s) return;
    s.ok = (s.ok || 0) + 1;
    await chrome.storage.local.set({ tokenStats });
  }).catch(e => console.warn("[UnbaitDK] Kunne ikke gemme forbrug:", e));
}

function getTokenStats(provider) {
  return withStatsLock(async () => {
    const { tokenStats = {} } = await chrome.storage.local.get("tokenStats");
    return tokenStats[provider] || null;
  });
}

function resetTokenStats(provider) {
  return withStatsLock(async () => {
    const { tokenStats = {} } = await chrome.storage.local.get("tokenStats");
    delete tokenStats[provider];
    await chrome.storage.local.set({ tokenStats });
    return { ok: true };
  });
}

// =====================================================================
// Automatisk tilpasning til modeller, der ikke understøtter alle parametre
// =====================================================================
const paramFixes = new Map(); // "udbyder|model" -> liste af rettelser

function findFix(body, raw) {
  let msg = raw, param = "";
  try { const e = JSON.parse(raw).error || {}; msg = (e.message || raw); param = e.param || ""; } catch {}
  const has = (p) => param === p || new RegExp("['\"`]?" + p + "['\"`]?", "i").test(msg);
  const unsupported = /unsupported|not supported|unknown|unrecognized|not allowed|extra inputs|does not support|invalid/i.test(msg);
  // OpenRouter (v1.51): en model, der skal tænke, afviser effort "none" ("Reasoning is mandatory … cannot be
  // disabled") – så tænker den lidt, men tænkningen sendes ikke med tilbage, og der er plads til den i max_tokens
  if (body.reasoning?.effort === "none" && has("reasoning") && /mandatory|required|cannot be disabled/i.test(msg)) return "reasoning:exclude";
  // v1.62: en model uden tænkning, der afviser parameteren, får den fjernet
  if (body.reasoning && has("reasoning") && unsupported) return "drop:reasoning";
  if (!unsupported) return null;
  if ("max_tokens" in body && has("max_tokens") && /max_completion_tokens/.test(msg)) return "max_tokens->max_completion_tokens";
  if ("max_completion_tokens" in body && has("max_completion_tokens")) return "max_completion_tokens->max_tokens";
  if ("temperature" in body && has("temperature")) return "drop:temperature";
  // "none" afvist: fald tilbage til "low" i stedet for at fjerne parameteren (så ville modellen tænke mere)
  if ("reasoning_effort" in body && has("reasoning_effort")) return body.reasoning_effort === "none" ? "reasoning_effort:low" : "drop:reasoning_effort";
  if ("thinking" in body && has("thinking")) return "drop:thinking";
  if ("include_reasoning" in body && has("include_reasoning")) return "drop:include_reasoning";
  return null;
}

function applyFix(body, fix) {
  if (fix === "max_tokens->max_completion_tokens" && "max_tokens" in body) {
    body.max_completion_tokens = Math.max(body.max_tokens, 2000); delete body.max_tokens;
  } else if (fix === "max_completion_tokens->max_tokens" && "max_completion_tokens" in body) {
    body.max_tokens = Math.min(body.max_completion_tokens, 300); delete body.max_completion_tokens;
  } else if (fix === "reasoning:exclude") {
    body.reasoning = { effort: "low", exclude: true };
    if ("max_tokens" in body) body.max_tokens = Math.max(body.max_tokens, 2000);
  } else if (fix === "reasoning_effort:low") {
    body.reasoning_effort = "low";
  } else if (fix.startsWith("drop:")) {
    delete body[fix.slice(5)];
  }
}

// ---- Gemini: sikkerhedsfilter (v1.46) ----
const GEMINI_SAFETY = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
  .map(category => ({ category, threshold: "BLOCK_NONE" }));
// Har Gemini blokeret overskriften? Så sendes der intet svar – kun promptFeedback.blockReason, eller et
// svar uden tekst med finishReason SAFETY o.l. Returnerer grunden eller "".
const GEMINI_BLOCK_FINISH = /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY)$/;
function geminiBlock(data) {
  if (data?.promptFeedback?.blockReason) return data.promptFeedback.blockReason;
  const fr = data?.candidates?.[0]?.finishReason;
  return fr && GEMINI_BLOCK_FINISH.test(fr) ? fr : "";
}

// OpenAI-kompatible udbydere (v1.94: samlet her): adressen og felterne ud over model og beskeder, i den rækkefølge de sendes
const OPENAI_COMPATIBLE = {
  // Ingen tænkning: hurtigere og billigere. Accepterer modellen ikke "none", bruges "low".
  openai: { url: "https://api.openai.com/v1/chat/completions",
    body: () => ({ max_completion_tokens: 2000, reasoning_effort: "none", temperature: 0.3 }) },
  // Groq: GPT-OSS kan ikke slå tænkningen helt fra – "low" er det mindste, og tænkningen sendes ikke med tilbage
  // (include_reasoning: false) (v1.27). v1.69: Qwen kan slå tænkningen helt fra (reasoning_effort "none" ifølge Groqs
  // dokumentation); include_reasoning sendes ikke
  groq: { url: "https://api.groq.com/openai/v1/chat/completions",
    body: (model) => /^qwen\//.test(model) ? { max_completion_tokens: 2000, reasoning_effort: "none", temperature: 0.3 }
      : { max_completion_tokens: 2000, reasoning_effort: "low", include_reasoning: false, temperature: 0.3 } },
  // Amazons egen Nova-API (v1.38). Nova 2 Lite tænker kun, hvis reasoning_effort sendes – det gør vi ikke.
  nova_free: { url: "https://api.nova.amazon.com/v1/chat/completions", body: () => ({ max_tokens: 300, temperature: 0.3 }) },
  // OpenRouter (v1.51): tænkning slås fra (reasoning.effort "none"), hvor modellen tillader det
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", body: () => ({ max_tokens: 300, temperature: 0.3, reasoning: { effort: "none" } }) },
  // Kilo Code (v1.84, kilo.ai/docs/gateway): gratis modeller kan bruges uden nøgle; kilo_key er brugerens Kilo-konto (v1.85).
  // Auto Free kan vælge en tænkende model, så der er plads til tænkningen (v1.86: max_tokens 4000); den fjernes fra svaret.
  kilo: { url: "https://ai-gateway.kilo.ai/api/v1/chat/completions", body: () => ({ max_tokens: 4000, temperature: 0.3 }) },
  kilo_key: { url: "https://ai-gateway.kilo.ai/api/v1/chat/completions", body: () => ({ max_tokens: 4000, temperature: 0.3 }) },
  // DeepSeek: tænkning slås fra – hurtigere og billigere
  deepseek: { url: "https://api.deepseek.com/chat/completions", body: () => ({ thinking: { type: "disabled" }, max_tokens: 300, temperature: 0.3 }) }
};
const isGemini = (p) => p === "gemini" || p === "gemini_free";

// fetch + læsning af HELE svaret under samme tidsgrænse (fund 10)
async function fetchText(url, opts, ms, outerSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const raw = await res.text();
    return { res, raw };
  } catch (e) {
    if (outerSignal?.aborted) throw new Error("aborted: slukket");
    throw e;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onAbort);
  }
}

// feedback: kun i andet forsøg – fortæller AI'en, hvorfor det forrige svar blev afvist
// label: mærkatet på forsidekortet (fx "chok-sag"), sendes med under overskriften (v1.19)
// urlText: teksten fra artiklens adresse – bruges, når der intet uddrag er (v1.20), og fra v1.30
// også, når uddraget er kort (under SHORT_EXCERPT tegn)
// Beskeden til AI'en (v1.70: udtrukket, så puljen kan skønne tokens, før modellen er valgt)
function buildUserMsg(text, context, feedback, label, urlText) {
  // Meget korte overskrifter ("Stopper!") er også overskrifter – og har mest brug for uddraget
  const short = text.split(/\s+/).filter(Boolean).length <= 3;
  const note = short && context ? "\n\n(Overskriften er meget kort og fortæller ikke, hvad historien handler om. Brug uddraget til at skrive en overskrift, der gør det.)" : "";
  const urlLine = urlText ? "Teksten i artiklens adresse (uden æ, ø og å): " + urlText : "";
  return "Overskrift: " + text + (label ? "\nMærkat på forsiden: " + label : "") + note + (context
      ? "\n\nUddrag af artiklen:\n" + context + (urlLine ? "\n\n" + urlLine : "")
      : "\n\n(Intet uddrag tilgængeligt)" + (urlLine ? "\n" + urlLine : "")) +
    (feedback ? "\n\n" + feedback : "");
}

// Kilo Auto og OpenRouters Free Models Router vælger selv modellen. Loggen viser, hvilken model der svarede –
// første gang og hver gang den skifter (v1.91; før v1.91 én linje pr. kald). Huskes kun, mens baggrunden kører.
const lastAnswerModel = new Map();
function logAnswerModel(key, who, chosen, answered) {
  const m = answered || "(ukendt model)", prev = lastAnswerModel.get(key);
  if (prev === m) return;
  lastAnswerModel.set(key, m);
  ulog("info", "[UnbaitDK] " + who, chosen, "→ svar fra", m + (prev ? " (skiftet model)" : ""));
}

// pre (v1.70): { tier, reserved, stamp } – puljen har allerede reserveret plads hos denne model til første kald
// rawOpt (v1.91, »Få forslag til prompten«): { system, user, maxTokens } – egen systembesked og besked, mere plads til svaret,
// og hele svaret returneres (ikke kun første linje som en overskrift)
async function callAI(text, settings, context = "", signal, feedback = "", label = "", urlText = "", pre = null, rawOpt = null) {
  const prompt = rawOpt ? rawOpt.system : settings.prompt;
  const userMsg = rawOpt ? rawOpt.user : buildUserMsg(text, context, feedback, label, urlText);
  const key = settings.apiKey;
  if (!FIXED_MODELS[settings.provider]) throw new Error("Ukendt udbyder: " + settings.provider);
  const model = pickModel(settings.provider, settings.model)?.id || FIXED_MODELS[settings.provider];
  if (settings.provider === "chrome_local") {
    if (rawOpt) throw new Error("Chromes indbyggede AI kan ikke bruges til forslag til prompten");
    const out = String(await localPrompt(prompt, userMsg, signal) || "").trim();
    if (!out) throw new Error("Tomt svar fra Chromes indbyggede AI");
    recordUsage("chrome_local", { input: 0, output: 0, ms: lastLocalMs, retry: !!feedback }); // lokalt: kun antal kald og svartid
    return { text: cleanHeadline(out.split("\n")[0]), truncated: false };
  }
  if (!key && NEEDS_KEY(settings.provider)) throw new Error("Ingen API-nøgle");

  let url, body, headers = { "Content-Type": "application/json" };
  const chat = OPENAI_COMPATIBLE[settings.provider];
  if (chat) {
    // OpenAI-kompatible API'er (v1.94: én opbygning til alle): systemprompt + besked og udbyderens egne felter
    url = chat.url;
    if (NEEDS_KEY(settings.provider)) headers["Authorization"] = "Bearer " + key;   // Kilo uden nøgle sender ingen
    body = { model, messages: [{ role: "system", content: prompt }, { role: "user", content: userMsg }], ...chat.body(model) };
  } else if (settings.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    // Systemprompten markeres til caching. Er den under Anthropics minimum (512 tokens for
    // Haiku 5.5), ignoreres markeringen bare – uden fejl og uden ekstra pris.
    body = { model, max_tokens: 300, system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: userMsg }], thinking: { type: "disabled" } };
  } else {   // Gemini (begge)
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers["x-goog-api-key"] = key; // nøglen i en header i stedet for i adressen
    // Laveste filter for de fire kategorier, man selv må justere (v1.46). Nyheder om krimi, sex osv.
    // blev ellers blokeret. PROHIBITED_CONTENT og OTHER kan ikke slås fra – dem håndterer geminiBlock().
    body = { contents: [{ parts: [{ text: prompt + "\n\n" + userMsg }] }], safetySettings: GEMINI_SAFETY };
  }

  if (rawOpt) {   // v1.91: mere plads til et længere svar
    if (isGemini(settings.provider)) body.generationConfig = { maxOutputTokens: rawOpt.maxTokens };
    else for (const k of ["max_tokens", "max_completion_tokens"]) if (k in body) body[k] = Math.max(body[k], rawOpt.maxTokens);
  }
  const adaptKey = settings.provider + "|" + model;   // v1.94: modellen (Gemini har intet model-felt i kaldet)
  // Free Models Router (v1.52) vælger en ny model ved hvert kald: en rettelse gælder kun det ene kald og huskes
  // ikke, og et tomt svar, fordi tænkningen brugte hele pladsen, prøves én gang mere (så vælges en anden model)
  const router = settings.provider === "openrouter" && model === "openrouter/free";
  const kilo = isKiloTier(settings.provider);
  const baseBody = JSON.stringify(body);
  (paramFixes.get(adaptKey) || []).forEach(fix => applyFix(body, fix));

  let res, raw, ms = 0, data, rewritten;
  for (let emptyTry = 0; ; emptyTry++) {
  for (let attempt = 0; ; attempt++) {
    let reserved = 0, stamp = 0;
    // Betalte OpenRouter-modeller er ikke omfattet af grænsen for gratis kald (v1.62); hver Groq-model har sin tæller (v1.69)
    const tier = tierFor(settings.provider, model);
    const chars = prompt.length + userMsg.length;
    if (tier) {
      if (pre && pre.tier === tier) { reserved = pre.reserved; stamp = pre.stamp; }   // v1.70: reserveret af puljen
      else {
        reserved = estimateTokens(tier, chars);
        stamp = await freeTierGate(reserved, signal, tier);
      }
      pre = null;
    }
    if (signal?.aborted) throw new Error("aborted: slukket");
    const t0 = Date.now();
    ({ res, raw } = await fetchText(url, { method: "POST", headers, body: JSON.stringify(body) }, 30000, signal));
    ms = Date.now() - t0;   // svartid for selve kaldet (ikke ventetid i kø eller minutgrænse) (v1.24)
    if (tier) {
      // Ret reservationen til det faktiske forbrug (udbyderen oplyser det i svaret).
      // Groq tæller ikke tokens fra cache med i sin minutgrænse.
      let used = reserved;
      try {
        const d = JSON.parse(raw);
        if (tier === "gemini_free") used = d.usageMetadata?.totalTokenCount ?? reserved;
        else if (d.usage) used = Math.max(0, (Number(d.usage.total_tokens) || 0) - (Number(d.usage.prompt_tokens_details?.cached_tokens) || 0)) || reserved;
      } catch {}
      if (used !== reserved) await adjustFreeTokens(used - reserved, stamp, tier);
      if (res.ok) learnTokens(tier, chars, used);
    }
    // OpenRouter (v1.53) kan sende en fejl inde i et svar med status 200 ({"error": {"code": 400, …}}, intet "choices"):
    // den behandles som en fejl med fejlens egen kode, så kaldet kan tilpasses og prøves igen
    let status = res.status;
    if (res.ok && settings.provider === "openrouter") {
      try { const d = JSON.parse(raw); if (d.error && !d.choices?.length) status = Number(d.error.code) || 500; } catch {}
    }
    if (res.ok && status === res.status) break;
    // v1.90: Kilos 429 sætter varianten på pause (se KILO_PAUSE_MS). Fejlen kastes som før, så puljen straks tager reserven;
    // uden reserve stopper næste forsøg ved pausen i gateOnce uden at sende noget
    if (status === 429 && isKiloTier(tier)) await setKiloPause(tier);
    const fix = status === 400 && attempt < 4 ? findFix(body, raw) : null;
    if (!fix) throw new Error(`HTTP ${status}: ${raw.slice(0, 300)}`);
    applyFix(body, fix);
    if (!router) paramFixes.set(adaptKey, [...(paramFixes.get(adaptKey) || []), fix]);
    ulog("info", "[UnbaitDK] Model", body.model, "– tilpasser kald:", fix, router ? "(kun dette kald)" : "");
  }
  data = JSON.parse(raw);
  // Free Models Router vælger selv modellen: svaret fortæller hvilken (v1.51)
  // v1.91 (brugerens valg »mulighed 1«): kun første gang en model svarer, og når den skifter – ikke én linje pr. kald
  if (settings.provider === "openrouter") logAnswerModel(settings.provider + "|" + model, "OpenRouter:", openrouterModel(model).name, data.model);
  if (kilo) logAnswerModel(settings.provider, "Kilo Code:", MODEL_NAMES[settings.provider], data.model);   // v1.84/v1.85
  recordUsage(statsKey(settings.provider, model), { ...usageFrom(settings.provider, data), ms, retry: !!feedback });   // feedback = andet forsøg

  if (settings.provider === "anthropic") {
    const textBlock = data.content?.find(c => c.type === "text" || c.text);
    rewritten = textBlock?.text || data.content?.[0]?.text;
  } else if (isGemini(settings.provider)) {
    rewritten = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
  } else {
    rewritten = data.choices?.[0]?.message?.content;
    // v1.84: tænkning, der står i selve svaret (<think>…</think>), fjernes ved Kilo Code
    if (kilo && rewritten) rewritten = String(rewritten).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }
  // Free Models Router: tomt svar, fordi tænkningen brugte hele pladsen (v1.52)
  // v1.86: Kilo Code – tomt svar (tænkningen står i "reasoning", intet i "content") prøves én gang mere, uanset finish_reason
  const fr = data.choices?.[0]?.finish_reason || "?";
  const thoughtOut = (router && !rewritten && fr === "length") || (kilo && !rewritten);
  if (!thoughtOut) break;
  const who = kilo ? "Kilo Code" : "OpenRouter";
  if (emptyTry >= 1) {
    const e = new Error(kilo ? "Kilo Code: " + (data.model || "modellen") + " gav tomt svar (finish_reason: " + fr + ")"
      : "OpenRouter: " + (data.model || "modellen") + " brugte hele pladsen på at tænke");
    e.thoughtOut = data.model || "?"; e.thoughtWho = who; e.finishReason = kilo ? fr : ""; throw e;
  }
  if (kilo) ulog("info", "[UnbaitDK] Kilo Code:", data.model || "(ukendt model)", "gav tomt svar (finish_reason: " + fr + ") – prøver igen");
  else ulog("info", "[UnbaitDK] OpenRouter:", data.model || "(ukendt model)", "brugte hele pladsen på at tænke – prøver igen");
  body = JSON.parse(baseBody);   // forfra: tænkning slået fra igen
  }
  if (!rewritten && isGemini(settings.provider)) {
    const why = geminiBlock(data);
    if (why) { const e = new Error("Gemini blokerede overskriften (" + why + ")"); e.blocked = why; throw e; }
  }
  if (!rewritten) throw new Error("Tomt svar fra AI. Rå svar: " + raw.slice(0, 500));
  const truncated = data.stop_reason === "max_tokens" ||
    data.choices?.[0]?.finish_reason === "length" ||
    data.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return { text: rawOpt ? String(rewritten).trim() : cleanHeadline(rewritten), truncated };
}

// v1.68: er AI'ens svar det samme som originalen? Store og små bogstaver, mellemrum, anførselstegn og
// afsluttende tegn (. ! ? …) tæller ikke. Så er det ikke en omskrivning.
// headlineKey står i shared.js
const sameHeadline = (a, b) => !!headlineKey(a) && headlineKey(a) === headlineKey(b);

// Svarets anførselstegn fjernes, og fra v1.63 også ét afsluttende punktum (ikke »…« eller »...«)
function cleanHeadline(t) {
  return String(t).replace(/^["'“”»«]+|["'“”»«]+$/g, "").trim().replace(/(?<![.…])\.$/, "").trim();
}

// Afvis svar der ikke lever op til prompten (fund S01): intet spørgsmål eller udråb,
// ingen kommentarer, ikke afskåret. Ordgrænse: 17 ord i første forsøg og 20 ord i
// andet forsøg, så en lidt for lang, men korrekt overskrift slår clickbait-originalen.
// MAX_WORDS_FIRST og MAX_WORDS_RETRY står i shared.js
// Uddrag under så mange tegn regnes som korte: så sendes adressens tekst også med (v1.30)
const SHORT_EXCERPT = 400;
// v1.91 (audit A-04): kommentarkontrollen afgøres KUN af konkrete formuleringer, hvor AI'en taler om opgaven.
// Et emneord (»overskriften«, »uddraget«, »teksten«, »du« …) er ikke i sig selv en kommentar – det kan være en
// almindelig nyhed, fx »Avis retter overskriften efter kritik fra minister«. Formuleringerne gælder altid,
// uanset hvad originalen indeholder. Testet mod de 2.376 overskrifter og tekster i tests/pages (ingen rammes).
const COMMENT_PHRASES = [
  // En mærkat foran svaret: »Overskrift:«, »Ny overskrift:«, »Her er en neutral overskrift:«, »Omskrevet:«
  // – kun når der intet andet står før kolonnet (»Avis' overskrift om minister: …« er en nyhed)
  /^\s*(her er\s+(en|den|min)\s+)?((ny|nye|neutral|neutrale|omskrevet|omskrevne|alternativ|alternative|foreslået|forslag til|mere|informativ|informative|bedre)\s+)*(overskrift(en)?|omskrivning(en)?|omskrevet)\s*(er|lyder)?\s*:/i,
  /^\s*bemærk\s*:/i,                                                                 // »Bemærk: …«
  /\bher er (en|den|min)\b[^.:]{0,40}\b(overskrift|omskrivning)/i,                   // »Her er en ny og mere neutral overskrift …«
  /\b(den|min) (nye|neutrale|omskrevne|alternative|foreslåede|bedre|mere neutrale|mere informative) (overskrift|omskrivning)(en)?\b/i,   // »Den nye overskrift er …«
  // AI'en om selve opgaven – ikke citater som »Minister: Jeg kan ikke fortsætte«
  /\bjeg (kan|kunne) ikke (omskrive|skrive|finde|se|give|hjælpe|lave|besvare|afgøre|vurdere|læse)\b/i,
  /\bjeg (har|skal|vil) (omskrevet|omskrive|skrive|skrevet|lave|give|foreslå)\b/i,
  /\bsend mig (artiklen|teksten|uddraget|mere)\b|\b(du sender|du har sendt|angivne tekst|intet uddrag)\b/i,
  /\bingen oplysninger (i|om) (uddraget|teksten|artiklen|overskriften)\b/i,
  /\bifølge (artiklen|uddraget|overskriften|teksten)\b/i,                           // Haikus »ifølge artiklen …«
  // v1.91 (mulighed B, brugerens valg 7. nov.): ord i sammenhæng – AI'en taler om sine egne input. Fx »… men uddraget
  // oplyser ikke, hvad historien ellers handler om«. Ordet alene afviser ikke (»Avis retter overskriften …« er en nyhed)
  /\b(uddraget|artiklen|teksten|overskriften)\s+(ikke\s+)?(oplyser|nævner|siger|fortæller|beskriver|indeholder|viser|angiver|forklarer|uddyber|præciserer|giver|har ingen|nævnes|oplyses)\b/i,
  /\b(fremgår|står|nævnes|oplyses|omtales|beskrives)\s+(ikke\s+)?(i|af)\s+(uddraget|artiklen|teksten|overskriften)\b/i,
  /\b(uden|manglende|mangler)\s+(et\s+)?uddrag\b/i,
  /\bden originale overskrift\b/i,
  /\bhvad (historien|artiklen) (ellers |egentlig |konkret )?handler om\b/i
];
// v1.91 (mulighed B): »du« og »dig« er en kommentar, når originalen ikke selv har dem (som i v1.89)
const READER_WORDS = /\b(du|dig)\b/i;
function isAIComment(out, original = "") {
  return COMMENT_PHRASES.some(re => re.test(out)) || (READER_WORDS.test(out) && !READER_WORDS.test(original));
}

// Hvorfor et svar afvises: "" = godkendt, ellers en grund (bruges i beskeden til andet forsøg)
function rejectReason(original, out, truncated, maxWords = MAX_WORDS_FIRST) {
  if (truncated) return "afskaaret";
  if (!out) return "tomt";
  if (/[\r\n]/.test(out)) return "linjer";
  if (/[?!]/.test(out)) return "tegn";
  if (out.split(/\s+/).filter(Boolean).length > maxWords) return "lang";
  // Tegngrænsen følger ordgrænsen (9 tegn pr. ord), så en lang, men tilladt overskrift ikke afvises på antal tegn
  if (out.length > Math.max(maxWords * 9, original.length * 1.8)) return "lang";
  if (isAIComment(out, original)) return "kommentar";
  return "";
}
// v1.90 (audit A-03): en gemt omskrivning, der er længere end de nuværende ordgrænser (fx efter brugeren har sænket
// dem), bruges ikke – overskriften omskrives igen. Grænsen for andet forsøg gælder, for det er den højeste.
// »Live:« foran tæller ikke med (som ved selve omskrivningen)
function cachedTooLong(original, cachedText, settings) {
  if (!cachedText || cachedText === SKIP) return false;
  const orig = String(original).replace(/^\s*live\s*:\s*/i, ""), out = String(cachedText).replace(/^\s*live\b\s*:?\s*/i, "");
  return rejectReason(orig, out, false, settings.maxWordsRetry || MAX_WORDS_RETRY) === "lang";
}

// Gemt post, der stadig kan bruges (v1.94: fælles for lookupCached og rewriteHeadline), ellers null:
// - v1.68: en gemt »omskrivning«, der er identisk med originalen, bruges ikke (slettes) – overskriften prøves igen
// - v1.90 (audit A-03): en omskrivning, der er længere end de nuværende ordgrænser, bruges ikke
async function readUsableCache(key, text, settings) {
  const e = await readCache(key);
  if (!e) return null;
  if (e.v !== SKIP && sameHeadline(text, e.v)) { await chrome.storage.local.remove(key); return null; }
  if (cachedTooLong(text, e.v, settings)) return null;
  return e;
}

// Beskeden, der sendes med i andet forsøg (under overskrift og uddrag – prompten røres ikke)
// Svar fra en sikkerhedsmodel bag OpenRouters Free Models Router (v1.54)
const ROUTER_SAFETY = /^\s*User Safety\s*:/i;
function retryFeedback(reason, out) {
  const words = String(out || "").split(/\s+/).filter(Boolean).length;
  const why = {
    linjer: "det fyldte flere linjer. Svar kun med én linje: selve overskriften",
    tegn: "det indeholdt spørgsmålstegn eller udråbstegn. Skriv et udsagn uden dem",
    lang: `det var for langt (${words} ord). Skriv en kortere overskrift`,
    kommentar: "det indeholdt en kommentar eller en henvisning til overskriften, artiklen eller uddraget. Svar kun med selve overskriften",
    afskaaret: "det blev afskåret. Skriv en kortere overskrift",
    tomt: "det var tomt. Svar kun med selve overskriften"
  }[reason] || "det ikke opfyldte kravene. Svar kun med selve overskriften";
  const prev = String(out || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `(Dit forrige svar blev afvist, fordi ${why}.` + (prev ? ` Dit forrige svar: »${prev}«)` : ")");
}

// =====================================================================
// Pulje (v1.70): den valgte model først; er dens minut- eller dagsgrænse fyldt, bruges den første ledige model i
// brugerens liste (prioriteret rækkefølge) i stedet for at vente. Kun hvis den valgte model har gratis-grænser og
// listen har modeller med nøgle; ellers som før. Cache og forbrug følger den model, der svarede.
// =====================================================================
const poolCool = new Map();            // modellens id -> tidspunkt, den må bruges igen (efter 429/5xx fra udbyderen)
const POOL_COOL_MS = 60000;
const POOL_COOL_RE = /HTTP (429|500|502|503|504|529)|overloaded|RESOURCE_EXHAUSTED/i;
function poolCandidates(settings) {
  const tier = tierFor(settings.provider, settings.model);
  const first = { id: poolId(settings.provider, settings.model), tier, settings };
  if (!tier) return [first];
  const out = [first];
  const known = new Map(poolEntries().map(e => [e.id, e]));
  for (const id of settings.pool || []) {
    const e = known.get(id), key = e && (NEEDS_KEY(e.provider) ? settings.keys?.[e.provider] : "");
    if (!e || (NEEDS_KEY(e.provider) && !key) || out.some(c => c.id === id)) continue;
    const model = e.model || FIXED_MODELS[e.provider];
    out.push({ id, tier: tierFor(e.provider, model), settings: { ...settings, provider: e.provider, model, apiKey: key } });
  }
  return out;
}
async function chooseTarget(settings, chars, signal) {
  const cands = poolCandidates(settings);
  if (cands.length < 2) return { settings };   // som før: callAI venter selv på plads
  for (;;) {
    let wait = Infinity, firstFull = null;
    for (const c of cands) {
      const cool = (poolCool.get(c.id) || 0) - Date.now();
      if (cool > 0) { wait = Math.min(wait, cool); continue; }
      const reserved = estimateTokens(c.tier, chars);
      const r = await gateOnce(reserved, c.tier);
      if (r.stamp) return { settings: c.settings, id: c.id, pre: { tier: c.tier, reserved, stamp: r.stamp } };
      if (r.wait) wait = Math.min(wait, r.wait); else if (!firstFull) firstFull = r.full;
    }
    if (!isFinite(wait)) throw firstFull || new Error("Ingen model til rådighed");   // alle har nået dagsgrænsen
    await sleep(wait, signal);
  }
}

// =====================================================================
// Kø og annullering (fund 02 og 10)
// Højst 3 AI-kald samtidig. Slukkes UnbaitDK, afbrydes igangværende kald, og
// ventende kald startes aldrig.
// =====================================================================
let aiActive = 0;
const aiWaiting = [];
let epoch = 0;                       // tælles op ved sluk – gamle opgaver er så ugyldige
const activeControllers = new Set();

async function enqueue(fn) {
  const myEpoch = epoch;
  while (aiActive >= 3) await new Promise(r => aiWaiting.push(r));
  aiActive++;
  const ctrl = new AbortController();
  activeControllers.add(ctrl);
  try {
    for (let attempt = 0; ; attempt++) {
      // Tjek lige før hvert kald, at UnbaitDK stadig er tændt
      if (myEpoch !== epoch || !(await isEnabled()) || ctrl.signal.aborted) throw new Error("UnbaitDK er slukket");
      try { return await fn(ctrl.signal); }
      catch (e) {
        const m = e.message || "";
        if (/slukket/.test(m) || ctrl.signal.aborted) throw new Error("UnbaitDK er slukket");
        if (attempt < 3 && /HTTP (429|500|502|503|504|529)|overloaded|RESOURCE_EXHAUSTED|Failed to fetch|NetworkError|aborted/i.test(m)) {
          await sleep(2000 * (attempt + 1), ctrl.signal).catch(() => {});
          continue;
        }
        throw e;
      }
    }
  } finally {
    activeControllers.delete(ctrl);
    aiActive--;
    aiWaiting.shift()?.();
  }
}

function cancelAll() {
  epoch++;
  for (const c of activeControllers) c.abort();
}

// Samme artikel + overskrift + indstillinger + uddrag deles mellem samtidige forespørgsler.
// Hver forespørgsel fra en fane har et jobId; afbryder alle fanerne, stoppes kaldet.
const inFlight = new Map(); // nøgle -> { promise, ctrl, waiters:Set }
const jobToFlight = new Map();
// v1.64: annulleringer, der kommer, før opgaven er registreret (mens indstillinger og cache læses) – job-id -> tidspunkt
const earlyCancels = new Map();
const EARLY_CANCEL_TTL = 60000;
function takeEarlyCancel(jobId) {
  const now = Date.now();
  for (const [id, t] of earlyCancels) if (now - t > EARLY_CANCEL_TTL) earlyCancels.delete(id);
  return jobId != null && earlyCancels.delete(jobId);
}

// force (v1.91, »Prøv igen« / »Omskriv alligevel«): den gemte omskrivning springes over, og der laves altid et nyt
// AI-kald – også selv om samme overskrift er i gang andre steder. Svaret erstatter cacheposten.
async function rewriteHeadline({ text, article, context, label = "", urlText = "", jobId, force = false }) {
  maybeCleanCache();
  const settings = await getSettings(); // fast øjebliksbillede for hele opgaven (fund 07)
  if (!settings.enabled) return { error: "UnbaitDK er slukket" };
  if (!settings.apiKey && NEEDS_KEY(settings.provider)) return { error: "Ingen API-nøgle sat" };

  const sig = await settingsSignature(settings);
  const key = await cacheKeyFor(article, text, sig);
  const excerptHash = await sha((context || "") + (label ? "\n#" + label : ""));

  // Cache: samme artikel, overskrift og indstillinger – og samme uddrag
  // Et nyt svar (under 2 timer) bruges, selv om uddraget afviger lidt: EB's artikelsider ændrer
  // sig fra hentning til hentning (fx tidspunkter), og det må ikke koste et nyt kald.
  // Først når posten er ældre end 2 timer, afgør uddraget, om artiklen er ændret.
  if (!force && await isKept(article, text)) return { kept: true };   // v1.91: »Behold originalen«
  const cached = force ? null : await readUsableCache(key, text, settings);
  const fresh = cached && Date.now() - cached.t <= REVALIDATE_AFTER;
  if (cached && (fresh || cached.x === excerptHash)) {
    // Artiklen er uændret: markér posten som tjekket, så den ikke tjekkes igen foreløbig
    if (!fresh && cached.v !== SKIP) await writeCache(key, cached.v, excerptHash);
    if (cached.v === SKIP) return { skip: true, cached: true };
    return { rewritten: cached.v, cached: true };
  }

  // v1.67: liveblogs – »Live:« foran originalen fjernes, før AI'en får overskriften, og sættes foran svaret igen
  const liveMatch = /^\s*live\s*:\s*/i.exec(text);
  const aiText = liveMatch ? text.slice(liveMatch[0].length) : text;
  const withLive = (t) => liveMatch ? "Live: " + t.replace(/^\s*live\b\s*:?\s*/i, "") : t;

  // v1.64: blev opgaven annulleret, mens indstillinger og cache blev læst, startes intet kald
  if (takeEarlyCancel(jobId)) return { cancelled: true };

  // Samtidige forespørgsler på samme artikel + overskrift deler ét kald, også med lidt forskelligt uddrag.
  // Et afbrudt kald genbruges ikke (v1.64) – det ville give den nye opgave »UnbaitDK er slukket«.
  const flightKey = force ? key + "|force|" + jobId : key;   // v1.91: »Prøv igen« deler ikke kald
  let flight = inFlight.get(flightKey);
  if (flight?.ctrl.signal.aborted) flight = null;
  if (!flight) {
    const ctrl = new AbortController();
    flight = { ctrl, waiters: new Set() };
    flight.promise = (async () => {
      let used = settings;   // v1.70: den model (valgt eller fra puljen), der svarede sidst
      // v1.94: loglinje om overskriften med udbyder/model og artiklens adresse på næste linje
      const logHeadline = (level, ...msg) => ulogM(level, logModel(used), ...msg, "\n   Adresse:", article || "(intet link)");
      // Afvisningen huskes i 1 dag – men ikke ved »Prøv igen« (force), som beholder den gamle omskrivning (v1.91)
      const skipRemembered = async () => { if (!force) await writeCache(key, SKIP, excerptHash); return { skip: true }; };
      try {
        // Et afvist svar prøves én gang mere med det samme – AI'en svarer ikke ens hver gang
        // Andet forsøg får at vide, hvorfor det første blev afvist
        let rewritten = "", truncated = false, feedback = "";
        // Adressens tekst sendes med, når der intet uddrag er, eller uddraget er kort (v1.30)
        const useUrl = urlText && (!context || context.length < SHORT_EXCERPT) ? urlText : "";
        for (let attempt = 1; attempt <= 2; attempt++) {
          ({ text: rewritten, truncated } = await enqueue(async (signal) => {
            const both = AbortSignal.any ? AbortSignal.any([signal, ctrl.signal]) : signal;
            const chars = settings.prompt.length + buildUserMsg(aiText, context, feedback, label, useUrl).length;
            const tg = await chooseTarget(settings, chars, both);
            used = tg.settings;
            try { return await callAI(aiText, tg.settings, context, both, feedback, label, useUrl, tg.pre); }
            catch (e) {
              // Udbyderen er overbelastet eller har sagt stop: modellen hviler et minut, og næste forsøg tager den næste i puljen
              // v1.90: ikke Kilo – den har sin egen pause på 15 minutter (gateOnce), og minuttet her ville kun forsinke beskeden
              if (tg.id && POOL_COOL_RE.test(e.message || "") && !isKiloTier(tierFor(tg.settings.provider, tg.settings.model))) {
                poolCool.set(tg.id, Date.now() + POOL_COOL_MS);
                ulog("info", "[UnbaitDK] Puljen: " + (poolEntries().find(x => x.id === tg.id)?.name || tg.id) + " hviler et minut efter fejl");
              }
              throw e;
            }
          }));
          if (liveMatch) rewritten = rewritten.replace(/^\s*live\b\s*:?\s*/i, "");   // ordet tæller ikke med i ordgrænsen
          let reason = rejectReason(aiText, rewritten, truncated, attempt === 1 ? settings.maxWordsFirst : settings.maxWordsRetry);
          // Free Models Router (v1.54) kan vælge en sikkerhedsmodel, der svarer "User Safety: safe" – det er ikke en overskrift
          if (!reason && used.provider === "openrouter" && used.model === "openrouter/free" && ROUTER_SAFETY.test(rewritten)) reason = "sikkerhed";
          if (!reason) break;
          // Viser også, om der var et uddrag (v1.20), og artiklens adresse (v1.30)
          const info = context ? `[uddrag: ${context.length} tegn${useUrl ? " + adressens tekst" : ""}]`
            : useUrl ? "[intet uddrag – adressens tekst brugt]" : "[intet uddrag]";
          logHeadline("warn", `[UnbaitDK] Afviste AI-svar (forsøg ${attempt}) ${info} for`, text, "→", rewritten);
          // Sikkerhedssvaret kom fra en anden model end den næste, så der sendes ingen besked om det med (v1.54)
          feedback = reason === "sikkerhed" ? "" : retryFeedback(reason, rewritten);
          rewritten = "";
        }
        if (!rewritten) {
          // Uden uddrag kan afvisningen skyldes, at artiklen ikke blev hentet i tide.
          // Så huskes afvisningen ikke, og overskriften prøves igen ved næste indlæsning.
          return context ? skipRemembered() : { skip: true };
        }
        // v1.68: et svar, der er identisk med originalen, vises ikke (intet AI-ikon) og huskes i 1 dag
        if (sameHeadline(aiText, rewritten)) {
          const info = context ? `[uddrag: ${context.length} tegn]` : "[intet uddrag]";
          logHeadline("warn", `[UnbaitDK] Uændret svar ${info} for`, text);
          return skipRemembered();
        }
        rewritten = withLive(rewritten);
        await writeCache(key, rewritten, excerptHash); // gemmes under opgavens egen nøgle
        recordApproved(statsKey(used.provider, used.model));
        return { rewritten };
      } catch (err) {
        const msg = err.message || String(err);
        if (/slukket/.test(msg)) return { error: "UnbaitDK er slukket" };
        // Gemini blokerede overskriften (v1.46): ikke en fejl – originalen bliver stående som ved et afvist svar,
        // og blokeringen huskes i 1 dag, så overskriften ikke sendes igen ved hver indlæsning
        if (err.blocked) {
          logHeadline("warn", `[UnbaitDK] Gemini blokerede (${err.blocked}):`, text);
          return skipRemembered();
        }
        // Free Models Router: to tomme svar, fordi tænkningen brugte pladsen (v1.52) – ikke en fejl; originalen
        // bliver stående og huskes ikke, så overskriften prøves igen ved næste indlæsning (routeren vælger frit)
        if (err.thoughtOut) {
          logHeadline("warn", `[UnbaitDK] ${err.thoughtWho || "OpenRouter"} gav tomt svar to gange (sidst ${err.thoughtOut}${err.finishReason ? ", finish_reason: " + err.finishReason : ""}):`, text);
          return { skip: true };
        }
        ulogM("error", logModel(used), "[UnbaitDK] AI error:", err);
        // v1.63: OpenRouters udbyder (fx Google bag Gemma) afviser, fordi den er overbelastet – ikke en kvote hos brugeren
        if (used.provider === "openrouter" && /HTTP 429/.test(msg) && /upstream|Provider returned error/i.test(msg))
          return { error: "Modellen er overbelastet hos udbyderen – prøv en anden model eller senere" };
        if (/429|RESOURCE_EXHAUSTED|quota/.test(msg)) return { error: "Kvote overskredet – vent et minut og prøv igen" };
        return { error: msg };
      } finally {
        // Kun sin egen post – et nyere kald med samme nøgle må ikke fjernes (v1.64)
        if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
      }
    })();
    inFlight.set(flightKey, flight);
  }
  if (jobId) { flight.waiters.add(jobId); jobToFlight.set(jobId, flight); }
  try { return await flight.promise; }
  finally { if (jobId) { flight.waiters.delete(jobId); jobToFlight.delete(jobId); } }
}

function cancelJob(jobId) {
  const flight = jobToFlight.get(jobId);
  if (!flight) { if (jobId != null) earlyCancels.set(jobId, Date.now()); return; }   // v1.64: endnu ikke registreret
  flight.waiters.delete(jobId);
  jobToFlight.delete(jobId);
  if (flight.waiters.size === 0) flight.ctrl.abort(); // ingen venter længere på svaret
}

// v1.91: »Behold originalen« (højreklik på AI-ikonet): artikler, der ikke skal omskrives. Egen liste i storage.local
// (keptArticles: { id: tidspunkt }), så den ikke forsvinder med »Slet gemte omskrivninger« eller et skift af model.
const keptId = (article, text) => normalizeUrl(article) || "t:" + String(text || "").toLowerCase();
async function isKept(article, text) { const { keptArticles = {} } = await chrome.storage.local.get("keptArticles"); return !!keptArticles[keptId(article, text)]; }
const keptQueue = serialQueue();
function setKept({ article, text, keep }) {
  return keptQueue(async () => {
    const { keptArticles = {} } = await chrome.storage.local.get("keptArticles");
    const id = keptId(article, text);
    if (keep) keptArticles[id] = Date.now(); else delete keptArticles[id];
    await chrome.storage.local.set({ keptArticles });
    return { kept: !!keep };
  });
}

// Hurtigt cacheopslag uden uddrag. Er posten ældre end 2 timer, markeres den
// "stale", så fanen henter artiklen og tjekker, om den er ændret.
async function lookupCached({ text, article }) {
  if (!(await isEnabled())) return { off: true };
  if (await isKept(article, text)) return { kept: true };   // v1.91
  const settings = await getSettings();
  const key = await cacheKeyFor(article, text, await settingsSignature(settings));
  const e = await readUsableCache(key, text, settings);
  if (!e) return { miss: true };
  const stale = Date.now() - (e.t || 0) > REVALIDATE_AFTER;
  return e.v === SKIP ? { skip: true, stale } : { rewritten: e.v, stale };
}

// Hent artiklens HTML: kun fra de indbyggede sider (EB, B.T., TV 2 – builtin i sites.js), de medier, B.T. linker til (v1.30),
// og JFM-medierne, der linker til hinanden (fx fyens.dk -> avisendanmark.dk) (v1.80). Alle har adgang i manifestet.
const ARTICLE_EXTRA_HOSTS = /(^|\.)(euroinvestor\.dk|woman\.dk|berlingske\.dk|weekendavisen\.dk)$/;
async function fetchArticle(url) {
  try {
    const u = new URL(url), site = siteForHost(u.hostname);
    if (!site?.builtin && site?.id !== "jfm" && !ARTICLE_EXTRA_HOSTS.test(u.hostname)) return { html: "" };
    const { res, raw } = await fetchText(u.href, { credentials: "include" }, 6000);
    // v1.67: adressen efter en evt. omdirigering, så indholdsscriptet kan godkende den rigtige artikel
    return { html: res.ok ? raw.slice(0, 800000) : "", finalUrl: res.redirected ? res.url : "" };
  } catch {
    return { html: "" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) => { p.then(sendResponse, e => sendResponse({ error: e.message || String(e) })); return true; };
  // Indholdsscripts må kun bruge disse handlinger; resten kun fra extensionens egne sider
  const fromExtensionPage = sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
  switch (msg.action) {
    case "cached": return reply(lookupCached(msg));
    case "fetchArticle": return reply(fetchArticle(msg.url));
    case "rewrite": return reply(rewriteHeadline(msg));
    case "cancelJob": cancelJob(msg.jobId); return false;
    case "keepOriginal": return reply(setKept(msg));   // v1.91
    case "tabIcon": setTabPaused(sender.tab?.id, !!msg.paused); return false;   // v1.91: pauset medie
    case "getEnabled": return reply(Promise.all([getSettings(), getSites(), getPaused()]).then(([s, sites, paused]) =>
      ({ enabled: s.enabled !== false, model: modelNameFor(s) + (poolCandidates(s).length > 1 ? " + flere" : ""), sites, paused })));   // v1.91: pausede medier   // v1.75: »+ flere«, når puljen kan bruges
  }
  if (!fromExtensionPage) return false;
  switch (msg.action) {
    case "localAvailability": return reply(localAvailability());
    case "modelInfo":
      // v1.69: alle tællere (også én pr. Groq-model) med deres lagernøgle (tierKeys)
      return reply(Promise.all(Object.keys(FREE_TIERS).map(t => getFreeLimits(t))).then((all) =>
        ({ models: FIXED_MODELS,
           tierLimits: Object.fromEntries(Object.keys(FREE_TIERS).map((t, i) => [t, all[i]])), modelGroups: modelGroups(), poolEntries: poolEntries(),
           tierKeys: Object.fromEntries(Object.entries(FREE_TIERS).map(([k, t]) => [k, t.limitsKey])),
           tierDefaults: Object.fromEntries(Object.entries(FREE_TIERS).map(([k, t]) => [k, t.defaults])) })));
    case "freeUsage": return reply(getFreeUsage(FREE_TIERS[msg.tier] ? msg.tier : "gemini_free"));
    case "clearCache": return reply(clearCache());
    case "tokenStats": return reply(getTokenStats(msg.provider));
    case "resetTokenStats": return reply(resetTokenStats(msg.provider));
    case "suggestPrompt": return reply(suggestPrompt(msg));   // v1.91
    case "updateInfo": return reply(checkUpdate(!!msg.force).then(i => ({ ...i, current: chrome.runtime.getManifest().version_name })));   // v1.92
    case "testAI":
      return reply(callAI("Chok: Mand finder guld i haven", msg.settings || {},
        "En 54-årig mand fra Vejle fandt i weekenden en guldmønt fra 1600-tallet, da han gravede i sin have. Mønten er afleveret til Nationalmuseet.")
        .then(r => ({ rewritten: r.text })));
  }
  return false;
});

// =====================================================================
// Ikon og tænd/sluk – tilstanden ligger i storage.sync, som alle faner lytter på
// =====================================================================
function iconPaths(on) {
  const n = on ? "on" : "off";
  return { 16: `icons/${n}-16.png`, 32: `icons/${n}-32.png`, 48: `icons/${n}-48.png`, 128: `icons/${n}-128.png` };
}
async function updateIcon(on) {
  if (on === undefined) on = await isEnabled();
  await chrome.action.setIcon({ path: iconPaths(on) });
  await chrome.action.setTitle({ title: on ? "unbAIt DK er TÆNDT – klik for at slukke" : "unbAIt DK er SLUKKET – klik for at tænde" });
}

chrome.action.onClicked.addListener(async () => {
  await chrome.storage.sync.set({ enabled: !(await isEnabled()) });
  // Ikon, annullering og alle faner opdateres via storage.onChanged
});


// =====================================================================
// Sider (v1.37): hvilke sider unbAIt DK er aktiv på. Valget ligger i storage.sync som "sites".
// Ekstra Bladet, B.T. og TV 2 har indholdsscriptet fra manifestet; det tjekker selv valget.
// De andre sider får først indholdsscriptet, når brugeren har sat flueben, OG Chrome har givet
// lov (optional_host_permissions). Fjernes fluebenet eller tilladelsen, afregistreres scriptet.
// =====================================================================
async function getSites() {
  const { sites } = await chrome.storage.sync.get("sites");
  const ids = new Set(UNBAIT_SITES.map(s => s.id));
  return Array.isArray(sites) ? sites.filter(id => ids.has(id)) : [...DEFAULT_SITES];
}
// Indholdsscriptets filer i rækkefølge – de samme som under content_scripts i manifest.json
const CONTENT_JS = ["shared.js", "sites.js", "content.js"];
const siteQueue = serialQueue();
function syncSiteScripts() {
  return siteQueue(async () => {
    const sites = await getSites();
    const have = new Map((await chrome.scripting.getRegisteredContentScripts()).map(r => [r.id, r]));
    for (const s of UNBAIT_SITES.filter(s => !s.builtin)) {
      const id = "unbait-" + s.id;
      const want = sites.includes(s.id) && await chrome.permissions.contains({ origins: s.matches });
      if (want && !have.has(id)) {
        await chrome.scripting.registerContentScripts([{ id, matches: s.matches, js: CONTENT_JS, runAt: "document_idle" }]);
      } else if (want && (have.get(id).js || []).join() !== CONTENT_JS.join()) {
        // v1.94: en registrering fra en ældre version (uden shared.js) rettes, så indholdsscriptet får alle filer
        await chrome.scripting.updateContentScripts([{ id, js: CONTENT_JS }]);
      } else if (!want && have.has(id)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      }
    }
  });
}
chrome.permissions.onAdded.addListener(() => syncSiteScripts());
chrome.permissions.onRemoved.addListener(() => syncSiteScripts());

// =====================================================================
// v1.91: pause pr. medie i Chromes højrekliksmenu (brugerens ønske 6. nov. 2026). Ét punkt pr. medie, kun på
// det medies adresser; hver JFM-avis for sig (»Pause på fyens.dk«). Pausen gælder alle faner med mediet,
// indtil browseren lukkes (storage.session: pausedSites). Punkterne vises kun på medier, der er slået til,
// og ikke når unbAIt DK er slukket. Fanen viser det slukkede ikon, mens mediet holder pause.
// =====================================================================
const PAUSE_PREFIX = "unbait-pause|";
// Kun på selve siden – ikke »all«, som også omfatter ikonet i værktøjslinjen (»action«), hvor documentUrlPatterns
// ikke gælder, så alle medier stod i ikonets menu (brugerens fund 8. nov. 2026)
const PAUSE_CONTEXTS = ["page", "frame", "selection", "link", "editable", "image", "video", "audio"];
function pauseTargets(sites) {
  const out = [];
  for (const s of UNBAIT_SITES) {
    if (!sites.includes(s.id)) continue;
    if (s.id === "jfm") for (const d of siteDomains(s)) out.push({ key: "jfm:" + d, name: d, patterns: ["*://*." + d + "/*"] });
    else out.push({ key: s.id, name: s.name, patterns: s.matches });
  }
  return out;
}
async function getPaused() {
  try { const { pausedSites = [] } = await chrome.storage.session.get("pausedSites"); return pausedSites; } catch { return []; }
}
const menuQueue = serialQueue();
function syncPauseMenus() {
  if (!chrome.contextMenus) return Promise.resolve();
  return menuQueue(async () => {
    await chrome.contextMenus.removeAll();
    if (!(await isEnabled())) return;
    const [sites, paused] = await Promise.all([getSites(), getPaused()]);
    for (const t of pauseTargets(sites)) {
      await new Promise(res => chrome.contextMenus.create({ id: PAUSE_PREFIX + t.key, contexts: PAUSE_CONTEXTS, documentUrlPatterns: t.patterns,
        title: `unbAIt DK – ${paused.includes(t.key) ? "Genoptag" : "Pause"} på ${t.name}` }, () => { void chrome.runtime.lastError; res(); }));
    }
  });
}
async function togglePause(key) {
  const paused = await getPaused();
  const next = paused.includes(key) ? paused.filter(k => k !== key) : [...paused, key];
  await chrome.storage.session.set({ pausedSites: next });
  await syncPauseMenus();
  // Alle faner får besked; indholdsscriptet på mediet sætter originalerne tilbage eller går i gang igen
  await tellAllTabs({ action: "pauseChanged", paused: next });
  return next;
}
// Fanens ikon: slukket, mens mediet holder pause; ellers som den fælles tilstand (indholdsscriptet melder selv)
async function setTabPaused(tabId, paused) {
  if (tabId == null) return;
  const on = paused ? false : await isEnabled();
  chrome.action.setIcon({ tabId, path: iconPaths(on) }).catch(() => {});
}
if (chrome.contextMenus) chrome.contextMenus.onClicked.addListener((info) => {
  const id = String(info.menuItemId || "");
  if (id.startsWith(PAUSE_PREFIX)) togglePause(id.slice(PAUSE_PREFIX.length));
});
// En besked til indholdsscriptet i alle faner (faner uden indholdsscript svarer ikke – det er ingen fejl)
async function tellAllTabs(msg) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  tabs.forEach(t => chrome.tabs.sendMessage(t.id, msg).catch(() => {}));
}

// v1.94: alle ændringer i lageret, baggrunden reagerer på, samlet ét sted
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    // Tænd/sluk: ikon og annullering (fanerne lytter selv på storage.sync)
    if (changes.enabled) { const on = changes.enabled.newValue !== false; updateIcon(on); if (!on) cancelAll(); }
    if (changes.sites) syncSiteScripts();
    if (changes.enabled || changes.sites) syncPauseMenus();
  }
  // v1.75: nøglerne ligger i storage.local, som indholdsscriptet ikke kan se. Ændres de, får fanerne besked,
  // så »+ flere« i statusboksen følger med (en model i puljen uden nøgle tæller ikke)
  if (area === "local" && changes.apiKeys) tellAllTabs({ action: "modelChanged" });
});

// =====================================================================
// v1.91: »Få forslag til prompten« (indstillingssiden). Den valgte model får prompten, ordgrænserne og en kort
// beskrivelse af opgaven og af det, koden selv håndhæver, så den ikke foreslår noget, koden afviser, eller bruger
// plads på regler, der allerede håndhæves. Den skal bevare brugerens krav og kun ændre noget med en konkret fordel.
// =====================================================================
const SUGGEST_SYSTEM = `Du er ekspert i at skrive prompter til sprogmodeller. Du vurderer en prompt, som Chrome-udvidelsen unbAIt DK bruger, og foreslår forbedringer. Skriv på dansk. Svar KUN med gyldig JSON uden anden tekst, præcis i denne form:
{"vurdering": "hvad fungerer, og hvor er instruktionerne uklare eller modstridende", "forslag": [{"aendring": "konkret ændring", "begrundelse": "kort begrundelse"}], "prompt": "den samlede foreslåede prompt"}`;
function suggestUserMsg(prompt, first, retry) {
  return `OPGAVEN: Udvidelsen omskriver clickbait-overskrifter på danske nyhedssider til neutrale, informative overskrifter med AI. Prompten herunder sendes som systembesked ved hvert kald.

HVER BESKED TIL MODELLEN ser sådan ud: »Overskrift: <original>«, evt. »Mærkat på forsiden: …«, derefter »Uddrag af artiklen: …« eller »(Intet uddrag tilgængeligt)« og evt. »Teksten i artiklens adresse (uden æ, ø og å): …«. Ved meget korte overskrifter står der en note om at bruge uddraget. Ved andet forsøg står der »(Dit forrige svar blev afvist, fordi …)«.

DET HÅNDHÆVER UDVIDELSEN SELV (bør ikke fylde i prompten, medmindre det klart hjælper modellen):
- Kun første linje af svaret bruges.
- Svar med ? eller ! afvises.
- Højst ${first} ord i første forsøg og ${retry} ord i andet forsøg (og ca. 9 tegn pr. ord); længere svar afvises.
- Svar, der er en kommentar om opgaven (fx »Her er en neutral overskrift:«, »Den nye overskrift er …«, »Jeg kan ikke omskrive …«, »ifølge artiklen«), afvises.
- Anførselstegn og et afsluttende punktum fjernes. »Live:« foran originalen fjernes før kaldet og sættes på igen bagefter.
- Et svar, der er identisk med originalen, vises ikke. Et afvist svar prøves én gang mere.

KRAV TIL DIT SVAR:
- Bevar brugerens krav og hensigt. Foreslå kun en ændring, hvis den har en konkret fordel, og begrund den kort.
- Gør ikke prompten længere uden grund – kortere er bedre, når den virker lige så godt.
- Foreslå intet, der strider mod det, udvidelsen håndhæver (fx flere ord end grænsen).
- Er prompten allerede god, så sig det, giv få eller ingen forslag, og returnér den uændret som "prompt".

DEN AKTUELLE PROMPT:
"""
${prompt}
"""`;
}
function parseSuggestion(text) {
  const t = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  try {
    const j = JSON.parse(t.slice(a, b + 1));
    const forslag = (Array.isArray(j.forslag) ? j.forslag : []).map(f => ({ aendring: String(f?.aendring || f?.ændring || "").trim(), begrundelse: String(f?.begrundelse || "").trim() })).filter(f => f.aendring);
    if (typeof j.prompt !== "string" || !j.prompt.trim()) throw new Error("ingen prompt");
    return { vurdering: String(j.vurdering || "").trim(), forslag, prompt: j.prompt.trim() };
  } catch {
    return { vurdering: String(text || "").trim(), forslag: [], prompt: "", unparsed: true };
  }
}
async function suggestPrompt({ prompt, maxWordsFirst, maxWordsRetry }) {
  const settings = await getSettings();
  if (settings.provider === "chrome_local") return { error: "Chromes indbyggede AI kan ikke bruges til forslag til prompten" };
  if (!settings.apiKey && NEEDS_KEY(settings.provider)) return { error: "Ingen API-nøgle" };
  const first = Number(maxWordsFirst) || settings.maxWordsFirst, retry = Number(maxWordsRetry) || settings.maxWordsRetry;
  const r = await callAI("", settings, "", undefined, "", "", "", null,
    { system: SUGGEST_SYSTEM, user: suggestUserMsg(String(prompt || settings.prompt), first, retry), maxTokens: 4000 });
  return { ...parseSuggestion(r.text), model: modelNameFor(settings), first, retry };
}

// =====================================================================
// v1.92: besked om ny version (brugerens ønske 8. nov. 2026, preview godkendt). Versionsfilen ligger i det offentlige
// repo lytken-de/unbait-releases (koden bliver i det private repo). Den hentes højst én gang i døgnet – ved start af
// browseren, ved installation og når indstillingssiden åbnes. Der sendes intet om brugeren; GitHub svarer med
// »access-control-allow-origin: *«, så der skal ingen ekstra rettighed til.
// latest.json: { "version": "1.93", "zip": "https://github.com/lytken-de/unbait-releases/releases/download/…", "notes": "…" }
// =====================================================================
const UPDATE_URL = "https://raw.githubusercontent.com/lytken-de/unbait-releases/main/latest.json";
const UPDATE_EVERY = 24 * 60 * 60 * 1000;
const UPDATE_ZIP = /^https:\/\/github\.com\/lytken-de\/unbait-releases\//;   // kun links til release-repoet åbnes
async function checkUpdate(force = false) {
  const { updateInfo } = await chrome.storage.local.get("updateInfo");
  if (!force && updateInfo && Date.now() - (updateInfo.checkedAt || 0) < UPDATE_EVERY) return updateInfo;
  let info;
  try {
    const r = await fetch(UPDATE_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!/^\d+(\.\d+)+$/.test(String(j.version || ""))) throw new Error("ugyldig version");
    info = { latest: String(j.version), zip: UPDATE_ZIP.test(String(j.zip || "")) ? String(j.zip) : "",
      notes: String(j.notes || "").slice(0, 400), checkedAt: Date.now() };
  } catch (e) {
    info = { ...(updateInfo || {}), checkedAt: Date.now(), error: String(e.message || e) };   // tavst: prøv igen i morgen
  }
  await chrome.storage.local.set({ updateInfo: info });
  return info;
}

chrome.runtime.onInstalled.addListener(async () => {
  await cleanCache();
  updateIcon();
  syncSiteScripts();
  syncPauseMenus();
  checkUpdate(true).catch(() => {});   // v1.92
});
chrome.runtime.onStartup.addListener(() => { updateIcon(); maybeCleanCache(); syncSiteScripts(); syncPauseMenus(); checkUpdate().catch(() => {}); });
updateIcon();
syncSiteScripts();
syncPauseMenus();
