"use strict";

// Standardprompten (DEFAULT_PROMPT), ordgrænserne, udbydernavnene (PROVIDER_NAMES), NEEDS_KEY, DeepSeek-tiderne,
// Chromes indbyggede AI og standardværdierne for Skjul indhold står i shared.js

// ---- Ordgrænser for kvalitetstjekket ----
function readWords() {
  return { first: parseInt($("maxFirst").value, 10), retry: parseInt($("maxRetry").value, 10) };
}
function wordsError(w) {
  const ok = (x) => Number.isInteger(x) && x >= WORDS_MIN && x <= WORDS_MAX;
  if (!ok(w.first) || !ok(w.retry)) return `Max ord skal være et tal mellem ${WORDS_MIN} og ${WORDS_MAX}.`;
  if (w.retry < w.first) return "Max ord i andet forsøg må ikke være lavere end i første forsøg.";
  return "";
}
let standardPrompt = "";

// ---- Udbydere: én fast model hver (kommer fra baggrundsscriptet) ----
const isLocal = (p) => p === "chrome_local";
// Nøglefeltets pladsholder pr. udbyder – fra registret PROVIDERS
const KEY_PLACEHOLDER = Object.fromEntries(Object.entries(PROVIDERS).filter(([, P]) => P.keyPlaceholder).map(([p, P]) => [p, P.keyPlaceholder]));
// Egne gratis-grænser pr. udbyder (gratis Gemini og Groq)
let TIER_LIMITS = {}, TIER_DEFAULTS = {}, TIER_KEYS = {};
const isTier = (t) => !!TIER_DEFAULTS[t];
let currentTier = null;
let paidPerUsd = 0;   // Estimeret omskrivninger pr. USD for den valgte betalte model (forsiden)
let usage = null;   // dagens forbrug for den valgte gratis-tæller
// OpenRouter: modellerne i den ekstra liste (kommer fra baggrundsscriptet) og det gemte valg
// ---- Én modelliste ----
// Baggrundsscriptet sender alle udbyderes modeller (modelGroups): gruppe = værdien i "AI-udbyder",
// hvert punkt { value, name, provider, model?, paid? }. Gemini: de to modeller er to udbydere (gemini/gemini_free).
let GROUPS = {};
const chosenModel = { gemini: "gemini", kilo: "kilo", openai: "", openrouter: "", groq: "", ollama: "", anthropic: "", deepseek: "" };   // sidst valgte model pr. gruppe (gemmes i sync)
const GEMINI = ["gemini", "gemini_free"];
// Også Kilo Code har to »modeller«, der er to udbydere (uden og med nøgle)
const KILO = ["kilo", "kilo_key"];
const groupOf = (p) => GEMINI.includes(p) ? "gemini" : KILO.includes(p) ? "kilo" : p;
const group = () => $("provider").value;
const choice = () => {
  const g = group(), list = GROUPS[g] || [];
  if ($("model").value === CUSTOM_VALUE && CUSTOM_MODEL_PROVIDERS.includes(g)) return customItem(g);
  return list.find(m => m.value === $("model").value) || list[0] || {};
};
// ---- Eget model-id (gruppen hedder det samme som udbyderen; ved Google Gemini den betalte) ----
const customIds = {};   // det skrevne id pr. udbyder – huskes, også når en model i listen vælges
const ownValid = (g) => isCustomModel(g, customIds[g] || "");
// Uden et gyldigt id bruges listens første model, som i baggrunden
function customItem(g) {
  const id = customIds[g] || "", first = (GROUPS[g] || [])[0] || {};
  if (!ownValid(g)) return { ...first, value: CUSTOM_VALUE, name: "Eget model-id", custom: true };
  const tier = customTier(g, id);
  if (tier && !TIER_DEFAULTS[tier] && g === "groq") { TIER_DEFAULTS[tier] = PROVIDERS.groq.tier.defaults; TIER_KEYS[tier] = groqTierDef(id).limitsKey; }
  return { value: CUSTOM_VALUE, name: id, provider: g, model: id, custom: true, tier, statsKey: g + ":" + id, poolId: g + "|" + id };
}
const OWN_NAMES = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Google", deepseek: "DeepSeek", groq: "Groq", openrouter: "OpenRouter" };
const OWN_EXTRA = { groq: " Egne gratis-grænser som GPT-OSS 120B; de kan rettes nedenfor.", openrouter: " Ender id'et på :free, tæller det med i OpenRouters gratis-grænse.",
  gemini: " Bruger nøglen til den betalte Gemini." };
function showCustom() {
  const g = group(), on = $("model").value === CUSTOM_VALUE;
  $("customModel").hidden = $("customHint").hidden = !on;
  if (!on) return;
  if (document.activeElement !== $("customModel")) $("customModel").value = customIds[g] || "";
  $("customModel").placeholder = "Modellens id hos " + OWN_NAMES[g];
  customHint();
}
function customHint() {
  const g = group(), v = $("customModel").value.trim(), bad = !!v && !CUSTOM_ID_RE.test(v);
  $("customHint").className = "hint" + (bad ? " warn" : "");
  $("customHint").textContent = bad ? "Kun bogstaver, tal og . _ : / - @ (højst 100 tegn)."
    : `Modellens id hos ${OWN_NAMES[g]}. Prisen kendes ikke for egne modeller, så Forbrug viser kun tokens.${OWN_EXTRA[g] || ""}`;
}
// Det, der gemmes i sync som customModels
const customModelsOut = () => Object.fromEntries(CUSTOM_MODEL_PROVIDERS.filter(p => customIds[p] || chosenModel[p] === CUSTOM_VALUE)
  .map(p => [p, { id: customIds[p] || "", on: chosenModel[p] === CUSTOM_VALUE }]));
const chosenProvider = () => choice().provider || group();
const orPaid = () => group() === "openrouter" && !!choice().paid;
// Navnet på den valgte model
const nameOf = () => choice().name || "";
// Den valgte models tæller for gratis-grænser (null = ingen), forbrugstæller og id i puljen kommer fra baggrunden
// (modelGroups) – fx har hver Groq-model sin egen tæller, og forbruget tælles pr. OpenAI-model og pr. betalt OpenRouter-model
const tierOfChoice = () => choice().tier || null;
const statsKeyOfChoice = () => choice().statsKey || chosenProvider();
const poolIdOfChoice = () => choice().poolId || "";
// ---- Ollama: listen hentes fra Ollama selv (»Hent modeller fra Ollama«); indtil da kun den gemte model ----
const ollamaItem = (n) => ({ value: n, name: n || "Ingen model valgt", provider: "ollama", model: n, tier: null, statsKey: "ollama", poolId: "" });
function setOllamaModels(names) { GROUPS.ollama = names.length ? names.map(ollamaItem) : [ollamaItem("")]; }
let ollamaFetched = false;
function showOllamaOrigins(show) {
  $("ollamaOriginsText").textContent = "OLLAMA_ORIGINS=chrome-extension://" + chrome.runtime.id;
  $("ollamaOrigins").hidden = !show;
}
// Chrome spørger om lov til at kontakte Ollama (skal ske i et klik). Giver true, når der er lov
async function askOllamaPermission() {
  try { if (await chrome.permissions.contains({ origins: OLLAMA_ORIGINS })) return true; } catch {}
  try { return await chrome.permissions.request({ origins: OLLAMA_ORIGINS }); } catch { return false; }
}
async function fetchOllama() {
  ollamaFetched = true;
  const st = $("ollamaStatus");
  st.className = "ostat"; st.textContent = "Henter …";
  if (!(await askOllamaPermission())) { st.className = "ostat warn"; st.textContent = "Chrome gav ikke lov til Ollama."; return; }
  let r = null;
  try { r = await chrome.runtime.sendMessage({ action: "ollamaModels" }); } catch {}
  showOllamaOrigins(r?.error === "origins");
  if (r?.models) {
    const keep = chosenModel.ollama;
    setOllamaModels(r.models.includes(keep) || !keep ? r.models : [keep, ...r.models]);
    if (!keep && r.models.length) chosenModel.ollama = r.models[0];
    if (group() === "ollama") { fillModels(); showProvider(chosenProvider()); changed(); }
    st.className = "ostat ok";
    st.textContent = r.models.length ? `✓ ${r.models.length} ${r.models.length === 1 ? "model" : "modeller"} fundet` : "Ollama svarer, men har ingen modeller. Hent en model i Ollama først.";
  } else {
    st.className = "ostat warn";
    st.textContent = r?.error === "origins" ? "Ollama afviste kaldet fra unbAIt DK." : r?.error === "permission" ? "Chrome gav ikke lov til Ollama."
      : r?.error === "offline" ? "Ingen forbindelse til Ollama på denne computer. Start Ollama, og prøv igen." : "Ollama svarede med en fejl" + (r?.status ? ` (HTTP ${r.status})` : "") + ".";
  }
}
function modelOption(value, name) {
  const o = document.createElement("option"); o.value = value;
  const dot = document.createElement("span"); dot.className = "mdot"; dot.setAttribute("aria-hidden", "true");
  o.append(name, dot);
  return o;
}
function fillModels() {
  const g = group(), list = GROUPS[g] || [], own = CUSTOM_MODEL_PROVIDERS.includes(g);
  const opts = list.map(m => modelOption(m.value, m.name));
  if (own) { const o = modelOption(CUSTOM_VALUE, "Eget model-id…"); o.classList.add("own"); opts.push(document.createElement("hr"), o); }
  $("model").replaceChildren(...$("model").querySelectorAll(":scope > button"), ...opts);
  $("model").value = own && chosenModel[g] === CUSTOM_VALUE ? CUSTOM_VALUE : list.some(m => m.value === chosenModel[g]) ? chosenModel[g] : (list[0]?.value || "");
  showCustom();
  updateHealth();
}

// ---- Modellens status (modelHealth i storage.local, skrevet af baggrunden; modelHealthState i shared.js) ----
let health = {};
const HEALTH_TITLE = { ok: "Sidste kald lykkedes", old: "Ikke verificeret de seneste 14 dage", err: "Modellen/nøglen blev afvist – overvej at skifte", none: "Ingen data endnu" };
const healthDate = (t) => new Date(t).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
function healthOf(m) {
  if (m.custom && !ownValid(m.provider)) return { state: "none" };
  return modelHealthState(health, m.provider, m.model || PROVIDERS[m.provider]?.model || "");
}
const healthOfChoice = () => healthOf(choice());
// Kort tekst: forsiden; lang tekst: linjen under »Model«
const healthWords = (h) => h.state === "ok" ? "Virker" : h.state === "old" ? "Ikke verificeret de seneste 14 dage"
  : h.state === "err" ? (h.kind === "key" ? "Nøglen blev afvist" : "Modellen blev afvist") : "";
function setDot(d, h) { if (d) { d.dataset.st = h.state; d.title = HEALTH_TITLE[h.state]; } }
function updateHealth() {
  const g = group(), list = GROUPS[g] || [];
  for (const o of $("model").options) setDot(o.querySelector(".mdot"), healthOf(o.value === CUSTOM_VALUE ? customItem(g) : list.find(x => x.value === o.value) || {}));
  const h = healthOfChoice();
  setDot($("model").querySelector("selectedcontent .mdot"), h);
  const st = $("modelStat");
  st.hidden = false; st.dataset.st = h.state; st.title = HEALTH_TITLE[h.state];
  st.textContent = h.state === "none" ? "Ingen data endnu" : `Sidst tjekket: ${healthDate(h.t)} · ${healthWords(h)}${h.state === "err" ? " – overvej at skifte" : ""}`;
  updateHome();
}
// En ny eller ændret nøgle: udbyderens status starter forfra (grå), til næste kald
async function clearHealthFor(providers) {
  try {
    const { modelHealth = {} } = await chrome.storage.local.get("modelHealth");
    let n = 0;
    for (const k of Object.keys(modelHealth)) if (providers.includes(k.split("|")[0])) { delete modelHealth[k]; n++; }
    if (n) await chrome.storage.local.set({ modelHealth });
  } catch (e) { warnErr("modellens status")(e); }
}

// ---- Nøgle pr. udbyder ----
let apiKeys = {}, currentProvider = "openai";
let savedKeys = {};   // nøglerne, som de sidst blev gemt (en ændret nøgle nulstiller modellens status)

// ---- Pulje: flere gratis modeller i prioriteret rækkefølge ----
// POOL_ENTRIES kommer fra baggrundsscriptet ({ id, provider, name }); chosenPool = de valgte id'er, øverst = først.
let POOL_ENTRIES = [], chosenPool = [];
const poolHasKey = (provider) => !NEEDS_KEY(provider) || !!(provider === currentProvider ? $("apiKey").value.trim() : apiKeys[provider]);
// En kopi af en <template> i options.html (fast markup uden innerHTML)
const tpl = (id) => document.getElementById(id).content.cloneNode(true);
// Panelets ikon: det samme som på knappen, der åbner panelet
const panelIcon = (name) => document.querySelector(`[data-open="${name}"] svg`).cloneNode(true);
// De valgte modeller i prioriteret rækkefølge, uden den valgte model (som altid er først)
function poolPicked() {
  const me = poolIdOfChoice(), known = new Map(POOL_ENTRIES.map(e => [e.id, e]));
  return chosenPool.map(id => known.get(id)).filter(e => e && e.id !== me);
}
// Flytter en valgt model til plads "to" (0 = først) blandt de valgte
function poolMove(id, to) {
  const p = poolPicked().map(e => e.id), from = p.indexOf(id);
  if (from < 0) return;
  p.splice(from, 1); p.splice(Math.max(0, Math.min(p.length, to)), 0, id);
  chosenPool = [...p, ...chosenPool.filter(x => !p.includes(x))];
  showPool(id); changed();
}
function showPool(focusId) {
  // Kun når den valgte model selv har gratis-grænser (ellers kan unbAIt DK ikke se, at den er fyldt)
  const on = isTier(currentTier) && !orPaid();
  $("poolBox").style.display = on ? "" : "none";
  if (!on) return;
  closePoolMenu();
  const me = poolIdOfChoice();
  const picked = poolPicked();
  const rest = POOL_ENTRIES.filter(e => e.id !== me && !chosenPool.includes(e.id));
  const rows = [...picked, ...rest].map(e => {
    const on = chosenPool.includes(e.id), key = poolHasKey(e.provider), idx = picked.indexOf(e);
    const row = document.createElement("div"); row.className = "pool-row"; row.dataset.id = e.id;
    // Håndtag til at trække i; kun valgte modeller har en plads i rækkefølgen
    const grip = document.createElement("button"); grip.type = "button"; grip.className = "grip" + (on ? "" : " none"); grip.append(tpl("tplGrip"));
    grip.title = "Træk for at flytte (eller Alt + ↑/↓)"; grip.setAttribute("aria-label", "Flyt " + e.name + " (Alt + pil op/ned)");
    if (!on) grip.tabIndex = -1;
    const lab = document.createElement("label"); lab.className = "check" + (!on && !key ? " off" : "");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on; cb.disabled = !on && !key;
    cb.addEventListener("change", () => {
      chosenPool = chosenPool.filter(x => x !== e.id);
      if (cb.checked) chosenPool.push(e.id);
      showPool(); changed();
    });
    lab.append(cb, e.name);
    if (!on && !key) { const n = document.createElement("span"); n.className = "st-note"; n.textContent = "Ingen nøgle"; lab.append(n); }
    row.append(grip, lab);
    if (on) {
      grip.addEventListener("keydown", (ev) => {
        let to = null;
        if (ev.altKey && ev.key === "ArrowUp") to = idx - 1; else if (ev.altKey && ev.key === "ArrowDown") to = idx + 1;
        else if (ev.key === "Home") to = 0; else if (ev.key === "End") to = picked.length - 1;
        if (to !== null) { ev.preventDefault(); poolMove(e.id, to); }
      });
      grip.addEventListener("pointerdown", (ev) => startPoolDrag(ev, row, e.id));
      row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openPoolMenu(ev.clientX, ev.clientY, e.id); });
    }
    return row;
  });
  $("poolList").replaceChildren(...rows);
  if (focusId) $("poolList").querySelector(`[data-id="${CSS.escape(focusId)}"] .grip`)?.focus();
}
// Træk i håndtaget: en blå streg viser, hvor rækken lander
function startPoolDrag(ev, row, id) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const rows = () => [...$("poolList").querySelectorAll(".pool-row")].filter(r => chosenPool.includes(r.dataset.id) && r !== row && !r.querySelector(".grip.none"));
  row.classList.add("dragging"); document.body.style.cursor = "grabbing";
  let target = null, after = false;
  const clear = () => $("poolList").querySelectorAll(".over-top, .over-bottom").forEach(r => r.classList.remove("over-top", "over-bottom"));
  const move = (e) => {
    clear(); const rs = rows(); target = null;
    for (const r of rs) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { target = r; after = false; break; } }
    if (!target && rs.length) { target = rs[rs.length - 1]; after = true; }
    if (target) target.classList.add(after ? "over-bottom" : "over-top");
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    document.body.style.cursor = "";
    if (target) {
      const p = poolPicked().map(x => x.id).filter(x => x !== id);
      poolMove(id, p.indexOf(target.dataset.id) + (after ? 1 : 0));
    } else showPool(id);
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  move(ev);
}
// Højreklik-menu: Flyt op / ned / til top / til bund
let poolMenuId = null, poolMenuAt = 0;
function closePoolMenu() { const m = $("poolMenu"); if (m) m.hidden = true; poolMenuId = null; }
function openPoolMenu(x, y, id) {
  const m = $("poolMenu"), p = poolPicked(), i = p.findIndex(e => e.id === id);
  poolMenuId = id; poolMenuAt = performance.now();
  // Menuen flyttes ud på selve siden. Inde i panelet blev den placeret i forhold til panelet (indglidnings-
  // animationen på .db gør panelet til ramme for position: fixed) og endte uden for skærmen
  if (m.parentElement !== document.body) document.body.append(m);
  m.querySelector("[data-a=up]").disabled = m.querySelector("[data-a=top]").disabled = i <= 0;
  m.querySelector("[data-a=down]").disabled = m.querySelector("[data-a=bottom]").disabled = i >= p.length - 1;
  m.hidden = false;
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + "px";
  m.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}
function initPoolMenu() {
  const m = $("poolMenu");
  m.addEventListener("click", (ev) => {
    const a = ev.target.closest("button")?.dataset.a, id = poolMenuId;
    if (!a || !id) return;
    const i = poolPicked().findIndex(e => e.id === id), n = poolPicked().length;
    closePoolMenu();
    poolMove(id, { up: i - 1, down: i + 1, top: 0, bottom: n - 1 }[a]);
  });
  addEventListener("pointerdown", (ev) => { if (!m.hidden && !m.contains(ev.target)) closePoolMenu(); });
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !m.hidden) { closePoolMenu(); ev.stopImmediatePropagation(); } });
  addEventListener("scroll", () => { if (performance.now() - poolMenuAt > 300) closePoolMenu(); }, true);   // En rulning lige før højreklikket lukker ikke menuen
}

function $(id) { return document.getElementById(id); }

// Genkend nøgler, der tydeligvis hører til en anden udbyder.
// Google-nøgler begynder med "AIza", Anthropic med "sk-ant-", Groq med "gsk_". OpenAI og DeepSeek
// begynder begge med "sk-", så dem kan man ikke skelne – de tjekkes kun mod de andre.
// Nøglens kendetegn pr. udbyder (keyFamily i PROVIDERS); Amazon Nova og Kilo har intet kendt format
const FAMILY = Object.fromEntries(Object.entries(PROVIDERS).filter(([, P]) => P.keyFamily).map(([p, P]) => [p, P.keyFamily]));
const FAMILY_NAMES = { google: "Google Gemini", anthropic: "Anthropic/Claude", sk: "OpenAI- eller DeepSeek", groq: "Groq", openrouter: "OpenRouter" };
function keyFamily(key) {
  if (/^gsk_/.test(key)) return "groq";
  if (/^AIza/.test(key)) return "google";
  if (/^sk-ant-/.test(key)) return "anthropic";
  if (/^sk-or-/.test(key)) return "openrouter";   // OpenRouter-nøgler
  if (/^sk-/.test(key)) return "sk";
  return null;
}
function keyMismatch(provider, key) {
  if (!key || !NEEDS_KEY(provider)) return "";
  const fam = keyFamily(key);
  // Amazon Nova: nøglernes format kendes ikke, så kun nøgler, der tydeligt hører til andre, giver advarsel
  if ((provider === "nova_free" || provider === "kilo_key") && (!fam || fam === "sk")) return "";   // Kilos nøgleformat kendes ikke
  return fam && fam !== FAMILY[provider]
    ? `Nøglen ligner en ${FAMILY_NAMES[fam]}-nøgle, men udbyderen er sat til ${PROVIDER_NAMES[provider]}.`
    : "";
}

const KEY_HINT = "Gemmes kun i denne browser og synkroniseres ikke.";
// Teksten under grænserne (hint i PROVIDERS)
const FREE_HINTS = Object.fromEntries(Object.entries(PROVIDERS).filter(([, P]) => P.hint).map(([p, P]) => [p, P.hint]));
// Kilo Code har kun en grænse pr. time (RPH)
const isHourTier = (t) => !!TIER_DEFAULTS[t] && TIER_DEFAULTS[t].rph !== undefined;
// Forbruget mod den grænse, der gælder: { used, limit, label, ring } (pr. time for Kilo, ellers pr. dag)
function usedVsLimit(u, L, t = currentTier) {
  if (isHourTier(t)) return { used: (u && u.hour ? u.hour.length : 0), limit: L.rph, label: "Brugt i denne time", ring: "brugt i timen" };
  return { used: (u && u.requests) || 0, limit: L.rpd, label: "Brugt i dag", ring: "brugt i dag" };
}

// Noten i AI-kassens bund; ved OpenRouters Free Models Router en ekstra linje
const ROUTER_NOTE = "Den valgte model giver flere fejl end normalt.";
function showAiNote() {
  if (currentProvider === "ollama") { $("aiNote").textContent = "Overskrifterne omskrives én ad gangen og langsommere end hos online-udbydere."; return; }
  const lines = ["Overskrifterne omskrives langsommere end med betalte udbydere."];
  if (currentProvider === "openrouter" && choice().model === "openrouter/free") lines.push(ROUTER_NOTE);
  $("aiNote").replaceChildren(...lines.flatMap((t, i) => i ? [document.createElement("br"), t] : [t]));
}
async function showFreeInfo() {
  const box = $("freeBox"), p = currentProvider, t = currentTier;
  // Betalte OpenRouter-modeller har ingen gratis-grænser
  if (!isTier(t) || (p === "openrouter" && orPaid())) { box.style.display = "none"; $("freeRow").style.display = "none"; $("aiNote").textContent = ""; if (p === "ollama") showAiNote(); usage = null; showStats(); return; }
  let u = { requests: 0, tokens: 0 };
  try { u = await chrome.runtime.sendMessage({ action: "freeUsage", tier: t }); } catch {}
  if (p !== currentProvider || t !== currentTier) return;
  // "Brugt i dag" som række i listen under Model
  usage = u;
  const note = document.createElement("span"); note.className = "st-note";
  note.textContent = p === "gemini_free" ? " nulstilles ca. kl. 9" : "";
  if (isHourTier(t)) { const L = readLimits(t); $("freeRowK").textContent = "Brugt i denne time"; $("freeInfo").replaceChildren(`${nf((u.hour || []).length)} / ${nf(L.rph)} kald`); }
  else { $("freeRowK").textContent = "Brugt i dag"; $("freeInfo").replaceChildren(`${nf(u.requests)} kald · ${nf(u.tokens)} tokens`, note); }
  $("freeRow").style.display = "";
  showAiNote();
  $("freeHint").textContent = FREE_HINTS[p] || "";
  box.style.display = "block";
  showStats();   // Forbrug og forsiden opdateres herfra – én gang, også ved udbyderskift (showProvider kalder ikke selv showStats)
}
// ---- DeepSeek: dyr og billig tid ----
// DeepSeek tager dobbelt pris på hverdage kl. 01–04 og 06–10 UTC (undtagen kinesiske helligdage; DEEPSEEK_PEAK_UTC og
// isDeepseekPeak i shared.js). Tidsrummene vises i brugerens egen tid, så sommer-/vintertid passer automatisk.
function utcHourLocal(h) {
  const d = new Date(); d.setUTCHours(h, 0, 0, 0);
  return d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
function showPeakInfo() {
  const el = $("peakInfo");
  if (currentProvider !== "deepseek") { el.style.display = "none"; return; }
  const spans = DEEPSEEK_PEAK_UTC.map(([a, b]) => `${utcHourLocal(a)}–${utcHourLocal(b)}`).join(" og ");
  // Teksten er brugerens egen formulering
  const now = isDeepseekPeak() ? "(Lige nu: dobbelt pris)" : "(Lige nu: normalpris)";
  el.textContent = `DeepSeek har dobbelt pris på hverdage kl. ${spans} (dansk tid). ` +
    `Resten af døgnet, i weekender samt på kinesiske helligdage gælder normalpris. ${now}.`;
  el.style.display = "block";
}
setInterval(showPeakInfo, 60000);

// ---- Eget forbrug for den valgte udbyder ----
let lastStats = null;
// Fælles for Forbrug-panelet og forsiden – »Siden 3. nov. kl. 14.05« og svartiden »1,2« (sekunder pr. kald)
const sinceText = (t) => { const d = new Date(t); return "Siden " + d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }) + " kl. " + d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }); };
const speedText = (s) => (s.ms / s.timed / 1000).toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
async function showStats() {
  const p = currentProvider;
  updateDrawerSub();
  let s = null;
  const key = statsKeyOfChoice();
  try { s = await chrome.runtime.sendMessage({ action: "tokenStats", provider: key }); } catch {}
  if (p !== currentProvider || key !== statsKeyOfChoice()) return;
  lastStats = s && s.calls ? s : null;
  paidPerUsd = 0; if (!s || !s.calls) updateHome();   // Sættes igen nedenfor, når der er et tal
  const box = $("stats");
  const tiles = [];
  const tile = (label, value, note, span) => {
    const t = el("div", "tile" + (span ? " span" : ""));
    t.append(el("div", "k", label));
    const v = el("div", "v"); v.append(value); t.append(v);
    if (note) t.append(el("div", "n", note));
    tiles.push(t); return t;
  };
  const kpi = $("kpiStats");
  if (!s || !s.calls) {
    const empty = el("div", "empty");
    empty.append(panelIcon("stats"));
    empty.append(el("b", "", "Ingen kald endnu"), el("span", "", `Tallene dukker op, så snart unbAIt DK har omskrevet den første overskrift med ${nameOf() || "den valgte model"}.`));
    box.replaceChildren(empty);
    $("statsSince").textContent = "";
    kpi.replaceChildren(el("div", "", ""));
    kpi.firstChild.append(el("div", "num", "0"), el("div", "lbl", "godkendte omskrivninger"), el("div", "sub2", "af 0 kald"));
  } else {
    const hasOk = "ok" in s, hasRetries = "retries" in s;
    // KPI: godkendte omskrivninger og godkendt-procent
    const left = el("div", "");
    left.append(el("div", "num", nf(hasOk ? s.ok : s.calls)), el("div", "lbl", hasOk ? "godkendte omskrivninger" : "kald"),
      el("div", "sub2", [hasOk ? `af ${nf(s.calls)} kald` : "", hasRetries ? `${nf(s.retries)} genforsøg` : ""].filter(Boolean).join(" · ")));
    kpi.replaceChildren(left);
    if (hasOk) kpi.append(ring(Math.round(s.ok / s.calls * 100), "godkendt"));
    // Tokens
    if (isLocal(p)) {
      tile("Tokens", "Ingen", "kører lokalt, intet at betale for", true);
    } else {
      const inTile = tile("Tokens ind", nf(s.input), p === "ollama" ? "kører lokalt, intet at betale for" : "", true);
      if (s.cached) {
        const pct = Math.min(100, s.cached / Math.max(1, s.input) * 100);
        const split = el("div", "split"); const bl = document.createElement("b"); bl.style.width = pct + "%"; const gr = document.createElement("i"); gr.style.width = (100 - pct) + "%"; split.append(bl, gr);
        const legend = el("div", "legend");
        const l1 = el("span", "", ""), e1 = el("em", ""); e1.style.background = "var(--accent)"; l1.append(e1, `heraf ${nf(s.cached)} ind fra cache`);
        const l2 = el("span", ""), e2 = el("em", ""); e2.style.background = "var(--gray-bar)"; l2.append(e2, `${nf(Math.max(0, s.input - s.cached))} til fuld pris`);
        legend.append(l1, l2); inTile.append(split, legend);
      }
      const hasSpeed = !!s.timed;
      tile("Tokens ud", nf(s.output), "modellens svar", !hasSpeed);
    }
    if (s.timed) tile("Svartid", `${speedText(s)} sek.`, "pr. kald", isLocal(p));
    // Omskrivninger pr. USD, afrundet til hele hundreder fra 1.000 (også på forsiden)
    const perUsd = hasOk && s.cost > 0 && s.ok > 0 ? s.ok / s.cost : 0;
    paidPerUsd = perUsd ? (perUsd >= 1000 ? Math.round(perUsd / 100) * 100 : Math.round(perUsd)) : 0; updateHome();
    if (perUsd) tile("Estimeret omskrivninger pr. USD", "≈ " + nf(paidPerUsd), "", true);
    if (isTier(currentTier) && !orPaid() && usage) {
      const L = readLimits(currentTier), uv = usedVsLimit(usage, L);
      const t = isHourTier(currentTier) ? tile(uv.label, `${nf(uv.used)} / ${nf(uv.limit)} kald`, "", true)
        : tile("Brugt i dag", `${nf(usage.requests)} kald · ${nf(usage.tokens)} tokens`, "", true);
      const pct = uv.limit > 0 ? Math.min(100, uv.used / uv.limit * 100) : 0;
      const m = el("div", "meter"); const mb = document.createElement("b"); mb.style.width = pct + "%"; m.append(mb); t.append(m);
    }
    box.replaceChildren(...tiles);
    $("statsSince").textContent = sinceText(s.since);
  }
  $("resetStats").style.display = s && s.calls ? "" : "none";
  updateHome();
}

function updateKeyHint() {
  const mm = keyMismatch(currentProvider, $("apiKey").value.trim());
  $("keyHint").textContent = mm || KEY_HINT;
  $("keyHint").className = "hint" + (mm ? " warn" : "");
}

function showProvider(p) {
  currentProvider = p;
  currentTier = tierOfChoice();
  const t = currentTier;
  $("apiKey").value = apiKeys[p] || "";
  $("apiKey").placeholder = KEY_PLACEHOLDER[p] || "";
  // Nøglefeltet med »Test forbindelse« står altid; uden nøgle (Chrome indbygget AI, Kilo Code) kun knappen (og Kilos note)
  $("keyLb").style.display = $("keyHint").style.display = NEEDS_KEY(p) ? "" : "none";
  $("keyRow").querySelector(".keywrap").style.display = NEEDS_KEY(p) ? "" : "none";
  $("keyRow").classList.toggle("nokey", !NEEDS_KEY(p));
  $("kiloNote").style.display = p === "kilo" ? "" : "none";
  $("kiloKeyNote").style.display = p === "kilo_key" ? "" : "none";
  $("localBox").style.display = isLocal(p) ? "block" : "none";
  $("ollamaBox").style.display = p === "ollama" ? "block" : "none";
  if (p !== "ollama") $("ollamaOrigins").hidden = true;
  if (isTier(t)) { const L = { ...TIER_DEFAULTS[t], ...(TIER_LIMITS[t] || {}) }; $("limRpm").value = L.rpm ?? ""; $("limRpd").value = L.rpd ?? ""; $("limTpm").value = L.tpm ?? ""; $("limTpd").value = L.tpd ?? ""; $("limRph").value = L.rph ?? ""; }
  // Kilo Code har kun »Kald pr. time (RPH)«; RPM og RPD skjules
  const hour = isHourTier(t);
  $("limRpm").parentElement.style.display = $("limRpd").parentElement.style.display = hour ? "none" : "";
  $("limRph").parentElement.style.display = hour ? "" : "none";
  // Tokens pr. minut vises kun, når udbyderen har sådan en grænse (Amazon Nova har ikke)
  $("limTpm").parentElement.style.display = isTier(t) && TIER_DEFAULTS[t].tpm === undefined ? "none" : "";
  // Tokens pr. dag kun ved Groq; med fire felter står de to og to
  const hasTpd = isTier(t) && TIER_DEFAULTS[t].tpd !== undefined;
  $("limTpd").parentElement.style.display = hasTpd ? "" : "none";
  $("limGrid").className = hasTpd ? "g2" : hour ? "g1" : "g3";
  updateKeyHint();
  showFreeInfo();   // kalder showStats (og dermed updateHome), når forbruget er læst
  showPool();
  showPeakInfo();
  if (isLocal(p)) showLocalStatus();
  updateHome();
}

// ---- Chromes indbyggede AI: status og download (download kræver et klik) ----
const LOCAL_TEXT = {
  available: "Klar. Modellen er hentet og kan bruges.",
  downloadable: "Modellen skal hentes først (engangsdownload). Tryk 'Hent model'.",
  downloading: "Modellen er ved at blive hentet…",
  unavailable: "Kan ikke køre på denne computer eller i denne Chrome-version."
};
async function localState() {
  if (typeof LanguageModel !== "undefined") { const { state, opts, danish } = await localModelState(); return { state, opts, danish }; }
  try { return await chrome.runtime.sendMessage({ action: "localAvailability" }); } catch { return { state: "unavailable" }; }
}
async function showLocalStatus() {
  const r = await localState();
  if (currentProvider !== "chrome_local") return;
  $("localStatus").textContent = (LOCAL_TEXT[r.state] || ("Status: " + r.state) + (r.error ? " " + r.error : "")) +
    (r.state !== "unavailable" && r.danish === false ? " Dansk understøttes ikke officielt af din Chrome endnu. Modellen bruges uden sprogangivelse." : "");
  $("localStatus").className = "hint" + (r.state === "unavailable" ? " warn" : "");
  $("localDownload").style.display = (r.state === "downloadable" || r.state === "downloading") && typeof LanguageModel !== "undefined" ? "" : "none";
}
async function downloadLocal() {
  const r = await localState();
  const opts = r.opts || {};
  $("localDownload").disabled = true;
  try {
    const s = await LanguageModel.create({ ...opts, monitor(m) {
      m.addEventListener("downloadprogress", (e) => { $("localStatus").textContent = `Henter modellen… ${Math.round(e.loaded * 100)} %`; });
    } });
    s.destroy?.();
    showStatus("Modellen er hentet og klar.");
  } catch (e) {
    showStatus("Kunne ikke hente modellen: " + (e.message || e), { error: true });
  } finally {
    $("localDownload").disabled = false;
    showLocalStatus();
  }
}

function readLimits(tier = currentTier) {
  const D = TIER_DEFAULTS[tier] || TIER_DEFAULTS.gemini_free;
  const v = (id, d) => { const x = parseInt($(id).value, 10); return x > 0 ? x : d; };
  if (D.rph !== undefined) return { rph: v("limRph", D.rph) };   // Kilo Code
  const L = { rpm: v("limRpm", D.rpm), rpd: v("limRpd", D.rpd) };
  if (D.tpm !== undefined) L.tpm = v("limTpm", D.tpm);
  if (D.tpd !== undefined) L.tpd = v("limTpd", D.tpd);
  return L;
}
// Alle tælleres grænser, med felterne for den valgte udbyder og model
function allLimits() {
  return isTier(currentTier) ? { ...TIER_LIMITS, [currentTier]: readLimits(currentTier) } : { ...TIER_LIMITS };
}

// Et tomt promptfelt gemmes som standardprompten (readForm),
// og når feltet forlades – eller gemmes, mens det ikke har fokus – sættes standardprompten ind i feltet, så det viser det,
// der gælder. Mens brugeren skriver i feltet, røres det ikke.
function fillEmptyPrompt() {
  const f = $("prompt");
  if (f.value.trim() || document.activeElement === f) return false;
  f.value = DEFAULT_PROMPT; updatePromptCount();
  showStatus("Feltet var tomt – standardprompten er sat ind.");
  return true;
}
function readForm() {
  return {
    provider: chosenProvider(),
    apiKey: $("apiKey").value.trim(),
    prompt: $("prompt").value.trim() || DEFAULT_PROMPT,
    model: choice().model
  };
}

// ---- Skjul historier (gemmes i sync, så de følger Chrome-kontoen) ----
function readHide() {
  return {
    hideCats: [...document.querySelectorAll("#hideCats input:checked")].map(i => i.value),
    hidePlus: $("hidePlus").checked,
    hideAds: $("hideAds").checked,
    hideAdsAvisen: $("hideAdsAvisen").checked,
    hideAdsAller: $("hideAdsAller").checked,
    skipReelAds: $("skipReelAds").checked,
    hideGames: $("hideGames").checked,
    hideWords: $("hideWords").value.split(",").map(w => w.trim()).filter(Boolean).join(", "),
    hideMode: $("hideMode").value
  };
}
function showHide(h) {
  document.querySelectorAll("#hideCats input").forEach(i => { i.checked = (h.hideCats || []).includes(i.value); });
  $("hidePlus").checked = !!h.hidePlus;
  $("hideAds").checked = !!h.hideAds;
  $("hideAdsAvisen").checked = !!h.hideAdsAvisen;
  $("hideAdsAller").checked = !!h.hideAdsAller;
  $("skipReelAds").checked = !!h.skipReelAds;
  $("hideGames").checked = !!h.hideGames;
  $("hideWords").value = h.hideWords || "";
  $("hideMode").value = h.hideMode === "dim" ? "dim" : "remove";
  document.dispatchEvent(new Event("unbait:hide-shown"));   // options-ui.js viser mærker og valgknapper
}

// ---- Sider: hvilke sider unbAIt DK er aktiv på (gemmes i sync som "sites") ----
function readSites() {
  return [...document.querySelectorAll("#sites input[data-site]:checked")].map(i => i.dataset.site);
}
function showSites(list) {
  const on = Array.isArray(list) ? list : DEFAULT_SITES;
  document.querySelectorAll("#sites input[data-site]").forEach(i => { i.checked = on.includes(i.dataset.site); });
}
// Første flueben ved en ny side: Chrome spørger om lov (skal ske i selve klikket). Afvises det, fjernes fluebenet.
async function askSitePermission(input) {
  const site = UNBAIT_SITES.find(s => s.id === input.dataset.site);
  if (!input.checked || !site || site.builtin) return;
  let ok = false;
  try { ok = await chrome.permissions.request({ origins: site.matches }); } catch { ok = false; }
  if (!ok) {
    input.checked = false;
    showStatus(`Chrome gav ikke lov til ${site.name}. Fluebenet er fjernet.`, { error: true });
  }
}

// ---- Status (visningsfeltet i toppen): grønne beskeder forsvinder selv, fejl bliver stående ----
// Samme form som statusboksen på nyhedssiden – showStatus(besked, { error })
let statusTimer = null;
function showStatus(msg, { error = false, hideAfter = error ? 0 : 5000 } = {}) {
  const el = $("status");
  clearTimeout(statusTimer);
  el.hidden = false;
  el.classList.remove("hiding");
  el.className = "status " + (error ? "err" : "ok");
  $("statusMsg").textContent = msg;
  el.title = msg;                      // hele teksten, hvis den er for lang til feltet
  $("statusClose").hidden = !error;    // Fejl bliver stående og kan lukkes med ×
  if (hideAfter) statusTimer = setTimeout(hideStatus, hideAfter);
}
function hideStatus() {
  const el = $("status");
  clearTimeout(statusTimer);
  el.classList.add("hiding");
  statusTimer = setTimeout(() => { el.hidden = true; el.classList.remove("hiding"); el.title = ""; }, 400);
}
// »✓ Gemt«: lille besked til venstre for feltet i 2 sekunder – overskriver aldrig en fejl
let savedTimer = null;
// ---- Ord/token-tæller under prompten ----
const PROMPT_TOKEN_LIMIT = 1000;
function updatePromptCount() {
  const v = $("prompt").value.trim();
  const words = wordCount(v), tokens = Math.round(v.length / 3.5);
  $("pcount").textContent = `${words.toLocaleString("da-DK")} ord · ca. ${tokens.toLocaleString("da-DK")} tokens`;
  $("pwarn").hidden = tokens <= PROMPT_TOKEN_LIMIT;
  renderPromptKpi(words, tokens);
  updateHome();
}

// ---- Log: baggrundsscriptets beskeder fra storage.session ----
let logFilter = "all";
const LOG_LABEL = { info: "Info", warn: "Advarsel", error: "Fejl" };
async function readLog() {
  try { return (await chrome.storage.session.get("logEntries")).logEntries || []; } catch { return []; }
}
const logTime = (t) => new Date(t).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":");
// Søgning i loggen. Alle ord skal findes i beskeden og modelnavnet tilsammen;
// store og små bogstaver er ligegyldige. Virker sammen med Alle/Advarsler/Fejl
const logWords = () => ($("logSearch")?.value || "").toLowerCase().split(/\s+/).filter(Boolean);
function logShown(all) {
  const words = logWords();
  return all.filter(e => (logFilter === "all" || (logFilter === "warn" ? e.level !== "info" : e.level === "error")) &&
    (!words.length || (h => words.every(w => h.includes(w)))(((e.msg || "") + " " + (e.model || "")).toLowerCase())));
}
async function showLog() {
  const all = (await readLog()).slice().reverse();   // nyeste øverst
  const shown = logShown(all);
  $("logSearchClear").hidden = !$("logSearch").value;
  document.querySelectorAll("#logFilter button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === logFilter)));
  $("logInfo").textContent = `${shown.length} af ${all.length} beskeder (højst 500)`;
  const nw = all.filter(e => e.level === "warn").length, ne = all.filter(e => e.level === "error").length;
  const kl = el("div", ""); kl.append(el("div", "num", String(all.length)), el("div", "lbl", "beskeder"), el("div", "sub2", `${nw} advarsler · ${ne} fejl`));
  $("kpiLog").replaceChildren(kl);
  if (!shown.length) {
    const e = document.createElement("div"); e.className = "lg-empty"; e.textContent = !all.length ? "Ingen beskeder endnu." : logWords().length ? "Ingen beskeder matcher søgningen." : "Ingen beskeder af den valgte type.";
    $("log").replaceChildren(e); return;
  }
  $("log").replaceChildren(...shown.map(e => {
    const row = document.createElement("div"); row.className = "lg " + e.level;
    const t = document.createElement("span"); t.className = "lt"; t.textContent = logTime(e.t);
    const b = document.createElement("span"); b.className = "lb"; b.textContent = LOG_LABEL[e.level] || e.level;
    // Udbyder og model under ADVARSEL/FEJL (ikke ved info)
    if (e.model && e.level !== "info") { const md = document.createElement("span"); md.className = "mdl"; md.textContent = e.model; b.append(md); }
    const m = document.createElement("span"); m.className = "lm"; m.textContent = e.msg;   // altid som tekst
    row.append(t, b, m); return row;
  }));
}
async function copyLog() {
  // Kun de viste beskeder (filter og søgning)
  const text = logShown((await readLog()).slice().reverse()).map(e => `${logTime(e.t)} ${LOG_LABEL[e.level] || e.level}${e.model && e.level !== "info" ? " (" + e.model + ")" : ""}: ${e.msg}`).join("\n");
  try { await navigator.clipboard.writeText(text); showStatus("Loggen er kopieret."); }
  catch (e) { showStatus("Kunne ikke kopiere loggen: " + (e.message || e), { error: true }); }
}

function showSaved() {
  const el = $("saved");
  clearTimeout(savedTimer);
  el.hidden = false; el.classList.remove("hiding");
  savedTimer = setTimeout(() => { el.classList.add("hiding"); savedTimer = setTimeout(() => { el.hidden = true; el.classList.remove("hiding"); }, 400); }, 2000);
}
// Resultatet af Test forbindelse vises under knappen
function showTest(kind, title, detail = "") {
  const box = $("testResult");
  box.className = "test-res " + kind;
  const t = document.createElement("div"); t.className = "t";
  if (kind !== "busy") { const i = document.createElement("span"); i.className = "ico"; i.setAttribute("aria-hidden", "true"); i.textContent = kind === "ok" ? "✓" : "!"; t.append(i); }
  t.append(title);
  const parts = [t];
  if (detail) { const d = document.createElement("div"); d.className = "d"; d.textContent = detail; parts.push(d); }
  box.replaceChildren(...parts);
  box.hidden = false;
}
function clearTest() { $("testResult").hidden = true; $("testResult").replaceChildren(); }
// Fejltekst -> overskrift og forklaring
function testError(msg, provider) {
  msg = String(msg || "");
  if (/HTTP 40[13]\b|invalid[ _-]?api[ _-]?key|unauthori[sz]ed|authentication|permission[ _-]denied|API key not valid/i.test(msg))
    return ["Ugyldig API-nøgle", "Kontrollér nøglen og prøv igen."];
  if (provider === "openrouter" && /HTTP 429/.test(msg) && /upstream|Provider returned error/i.test(msg))
    return ["Modellen er overbelastet", "Prøv en anden model eller senere."];
  if (/grænse er nået/i.test(msg)) return ["Kvote overskredet", msg];
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return ["Kvote overskredet", "Vent lidt, eller vælg en anden model."];
  return ["Forbindelsen fejlede", msg.length > 160 ? msg.slice(0, 157) + "…" : msg];
}

// ---- Automatisk gem: ingen Gem-knap ----
// Flueben, valgknapper og udbyder gemmes med det samme. Tekstfelter gemmes efter en kort pause i
// skrivningen (sync-lageret tåler kun et begrænset antal skrivninger i minuttet) eller når feltet forlades.
// Ugyldige ordgrænser gemmes ikke; resten gemmes, og de sidst gyldige ordgrænser bliver stående.
// <html data-save> viser tilstanden: idle (intet ændret), pending, saving, saved eller error.
const TYPE_PAUSE = 800;
let savedSnapshot = "", savedWords = null, saveTimer = null, saving = null, saveAgain = false, idleState = "idle";
function snapshot() {
  const keys = { ...apiKeys, [currentProvider]: $("apiKey").value.trim() };
  const clean = {};
  Object.keys(keys).sort().forEach(k => { if (keys[k]) clean[k] = keys[k]; });
  const f = readForm();
  return JSON.stringify({ provider: f.provider, apiKeys: clean, prompt: f.prompt, limits: allLimits(), hide: readHide(), words: readWords(), sites: readSites(), models: chosenModel, custom: customModelsOut(), pool: chosenPool });
}
function setSaveState(st) { document.documentElement.dataset.save = st; if (st !== "pending" && st !== "saving") idleState = st; }
function changed(delay = 0) {
  updateHome();
  clearTimeout(saveTimer); saveTimer = null;
  if (snapshot() === savedSnapshot) { if (!saving) setSaveState(idleState); return; }
  setSaveState("pending");
  saveTimer = setTimeout(saveNow, delay);
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (saving) { saveAgain = true; return saving; }
  if (snapshot() === savedSnapshot) { setSaveState(idleState); return Promise.resolve(false); }
  saving = doSave().finally(() => {
    saving = null;
    if (saveAgain) { saveAgain = false; saveNow(); }
  });
  return saving;
}
async function doSave() {
  setSaveState("saving");
  const before = { ...apiKeys };
  apiKeys[currentProvider] = $("apiKey").value.trim();
  const s = readForm();
  const limits = allLimits();
  let words = readWords();
  const wErr = wordsError(words);
  if (wErr) words = savedWords;                       // de sidst gyldige ordgrænser bevares
  const keys = {};
  Object.keys(apiKeys).forEach(k => { if (apiKeys[k]) keys[k] = apiKeys[k]; });
  const snap = snapshot();
  try {
    // Begge skrivninger sendes af sted med det samme (ikke efter hinanden), så de også når frem, når siden lukkes
    await Promise.all([
      // Alle tælleres grænser under deres egen lagernøgle (fx groqLimits, groqLimits:openai/gpt-oss-20b)
      chrome.storage.local.set({ apiKeys: keys, ...Object.fromEntries(Object.entries(limits).filter(([t, L]) => L && TIER_KEYS[t]).map(([t, L]) => [TIER_KEYS[t], L])) }),
      chrome.storage.sync.set({ provider: s.provider, prompt: s.prompt, ...readHide(), maxWordsFirst: words.first, maxWordsRetry: words.retry, sites: readSites(),
        openrouterModel: chosenModel.openrouter, openaiModel: chosenModel.openai, groqModel: chosenModel.groq, ollamaModel: chosenModel.ollama,
        customModels: customModelsOut(), pool: chosenPool })
    ]);
  } catch (e) {
    // Ændringerne er IKKE gemt – de bliver stående i felterne og prøves igen ved næste ændring
    apiKeys = before; apiKeys[currentProvider] = $("apiKey").value.trim();
    setSaveState("error");
    showStatus("Kunne ikke gemme: " + (e.message || e) + ". Dine ændringer er ikke gemt.", { error: true });
    return false;
  }
  TIER_LIMITS = limits;
  const keyChanged = [...new Set([...Object.keys(savedKeys), ...Object.keys(keys)])].filter(p => (savedKeys[p] || "") !== (keys[p] || ""));
  savedKeys = keys;
  if (keyChanged.length) await clearHealthFor(keyChanged);
  savedWords = words;
  savedSnapshot = snap;
  setSaveState("saved");
  showSaved();   // Altid den lille »✓ Gemt« – en fejl i feltet bliver stående
  fillEmptyPrompt();   // Et tomt felt, der ikke har fokus, fyldes med den standardprompt, der blev gemt
  if (wErr) { showStatus(wErr + " Ordgrænserne er ikke gemt.", { error: true }); return true; }
  const warn = keyMismatch(s.provider, s.apiKey);
  if (warn) showStatus("Gemt, men bemærk: " + warn, { error: true });
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  const mf = chrome.runtime.getManifest();
  $("version").textContent = "v. " + (mf.version_name || mf.version);
  const info = await chrome.runtime.sendMessage({ action: "modelInfo" });
  TIER_LIMITS = { ...info.tierLimits }; TIER_DEFAULTS = { ...info.tierDefaults }; TIER_KEYS = { ...info.tierKeys };
  GROUPS = info.modelGroups || {};
  POOL_ENTRIES = info.poolEntries || [];
  initPoolMenu();

  // Udbyder og prompt følger Chrome-kontoen (sync); nøgler ligger kun lokalt
  const data = await chrome.storage.sync.get({ provider: "openai", prompt: DEFAULT_PROMPT, ...HIDE_DEFAULTS,
    maxWordsFirst: MAX_WORDS_FIRST, maxWordsRetry: MAX_WORDS_RETRY, standardPrompt: "", sites: null, openrouterModel: "", openaiModel: "", groqModel: "", ollamaModel: "", customModels: {}, pool: [] });
  chosenPool = (Array.isArray(data.pool) ? data.pool : []).filter(id => POOL_ENTRIES.some(e => e.id === id));
  // Gemte modeller hos OpenAI og OpenRouter; findes en ikke længere i listen, vælges den første
  const valid = (g, v) => (GROUPS[g] || []).some(m => m.value === v) ? v : (GROUPS[g]?.[0]?.value || "");
  chosenModel.openai = valid("openai", data.openaiModel);
  chosenModel.openrouter = valid("openrouter", data.openrouterModel);
  chosenModel.groq = valid("groq", data.groqModel);
  chosenModel.ollama = typeof data.ollamaModel === "string" ? data.ollamaModel.trim() : "";
  setOllamaModels(chosenModel.ollama ? [chosenModel.ollama] : []);
  standardPrompt = data.standardPrompt || "";
  $("maxFirst").value = data.maxWordsFirst; $("maxRetry").value = data.maxWordsRetry;
  showHide(data);
  showSites(data.sites);
  const local = await chrome.storage.local.get({ apiKeys: {} });
  apiKeys = { ...local.apiKeys }; savedKeys = { ...apiKeys };
  const provider = isProvider(data.provider) ? data.provider : "openai";

  if (GEMINI.includes(provider)) chosenModel.gemini = provider;
  if (KILO.includes(provider)) chosenModel.kilo = provider;
  // Eget model-id: det skrevne id huskes; »on« = valgt (ved Gemini kun, når den betalte er valgt)
  const cm = isObj(data.customModels) ? data.customModels : {};
  for (const p of CUSTOM_MODEL_PROVIDERS) {
    const c = isObj(cm[p]) ? cm[p] : null;
    if (c && CUSTOM_ID_RE.test(String(c.id || ""))) customIds[p] = String(c.id);
    if (c?.on === true && !(p === "gemini" && provider === "gemini_free")) chosenModel[p] = CUSTOM_VALUE;
  }
  if (customIds.groq) { const k = groqTierDef(customIds.groq).limitsKey, got = (await chrome.storage.local.get(k))[k]; if (got) TIER_LIMITS["groq:" + customIds.groq] = got; }
  health = (await chrome.storage.local.get("modelHealth")).modelHealth || {};
  $("provider").value = groupOf(provider);
  fillModels();
  $("prompt").value = data.prompt;
  updatePromptCount();
  showProvider(provider);
  savedSnapshot = snapshot();
  savedWords = readWords();
  setSaveState("idle");
  updateHome();

  $("statusClose").addEventListener("click", hideStatus);
  const providerChanged = () => {
    clearTest();   // Et testresultat gælder kun den udbyder/model/nøgle, det blev lavet med
    apiKeys[currentProvider] = $("apiKey").value.trim(); // husk det indtastede
    if (isTier(currentTier)) TIER_LIMITS[currentTier] = readLimits(currentTier);   // husk de indtastede grænser
    showProvider(chosenProvider());
    changed();
  };
  $("provider").addEventListener("change", () => {
    fillModels(); providerChanged();
    if (group() === "ollama" && !ollamaFetched) fetchOllama();   // Spørger om lov og henter modellerne
  });
  $("ollamaFetch").addEventListener("click", fetchOllama);
  $("ollamaCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("ollamaOriginsText").textContent); $("ollamaCopy").textContent = "✓ Kopieret"; }
    catch { getSelection().selectAllChildren($("ollamaOriginsText")); }
    setTimeout(() => { $("ollamaCopy").textContent = "Kopiér"; }, 2000);
  });
  // Modelskift: ved Gemini skifter udbyderen (gemini/gemini_free); ellers følger forbrug, noter og grænser modellen
  $("model").addEventListener("change", () => {
    chosenModel[group()] = $("model").value; showCustom(); providerChanged();
    if ($("model").value === CUSTOM_VALUE && !$("customModel").value) $("customModel").focus();
  });
  $("customModel").addEventListener("input", customHint);
  // Gemmes, når feltet forlades eller der trykkes Enter. Et id fra listen vælger modellen i listen
  $("customModel").addEventListener("change", async () => {
    const g = group(), v = $("customModel").value.trim();
    if (v && !CUSTOM_ID_RE.test(v)) return;
    const listed = (GROUPS[g] || []).find(m => (m.model || PROVIDERS[m.provider]?.model) === v && m.provider === g);
    if (listed) { chosenModel[g] = listed.value; fillModels(); providerChanged(); return; }
    customIds[g] = v;
    if (g === "groq" && v) { const k = groqTierDef(v).limitsKey, got = (await chrome.storage.local.get(k))[k]; if (got) TIER_LIMITS["groq:" + v] = got; }
    providerChanged(); updateHealth();
  });
  $("apiKey").addEventListener("input", () => { updateKeyHint(); clearTest(); showPool(); changed(TYPE_PAUSE); });
  // Øjet: vis/skjul nøglen
  $("keyEye").addEventListener("click", () => {
    const show = $("apiKey").type === "password";
    $("apiKey").type = show ? "text" : "password";
    $("keyEye").setAttribute("aria-pressed", String(show));
    $("keyEye").setAttribute("aria-label", show ? "Skjul nøgle" : "Vis nøgle");
    $("keyEye").title = show ? "Skjul nøgle" : "Vis nøgle";
  });
  $("prompt").addEventListener("input", updatePromptCount);
  $("prompt").addEventListener("blur", () => { fillEmptyPrompt(); changed(); });
  $("localDownload").addEventListener("click", downloadLocal);
  // Forsiden og panelerne
  document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openPanel(b.dataset.open, b)));
  $("dClose").addEventListener("click", closePanel);
  $("veil").addEventListener("click", closePanel);
  addEventListener("keydown", panelKeys);
  // Log
  document.querySelectorAll("#logFilter button").forEach(b => b.addEventListener("click", () => { logFilter = b.dataset.f; showLog(); }));
  $("logCopy").addEventListener("click", copyLog);
  $("logClear").addEventListener("click", async () => { await chrome.storage.session.remove("logEntries"); showLog(); });
  $("logSearch").addEventListener("input", () => showLog());
  initPromptSuggest();
  initUpdateNotice();
  initBackup();
  $("logSearchClear").addEventListener("click", () => { $("logSearch").value = ""; showLog(); $("logSearch").focus(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.logEntries && currentPanel === "log") showLog(); });
  // Tekstfelter: gem efter en pause i skrivningen, og straks når feltet forlades
  const TEXT_FIELDS = ["apiKey", "prompt", "limRpm", "limRpd", "limTpm", "limTpd", "limRph", "maxFirst", "maxRetry"];
  ["prompt", "limRpm", "limRpd", "limTpm", "limTpd", "limRph", "maxFirst", "maxRetry"].forEach(id => $(id).addEventListener("input", () => changed(TYPE_PAUSE)));
  TEXT_FIELDS.forEach(id => $(id).addEventListener("change", saveNow));
  document.querySelectorAll("#hideCats input, #hidePlus, #hideAds, #hideAdsAvisen, #hideAdsAller, #skipReelAds, #hideGames, #hideMode").forEach(el => el.addEventListener("change", () => changed()));
  $("hideWords").addEventListener("input", () => changed(TYPE_PAUSE));
  // Sider: en ny side gemmes først, når Chrome har svaret på spørgsmålet om lov
  document.querySelectorAll("#sites input[data-site]").forEach(el => el.addEventListener("change", async () => { await askSitePermission(el); changed(); }));
  // Lukkes eller skjules siden midt i en pause, gemmes der med det samme
  addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

  // Gendan original: udvidelsens oprindelige prompt; brugerens egen standard røres ikke
  $("restoreOriginal").addEventListener("click", async () => {
    $("prompt").value = DEFAULT_PROMPT; updatePromptCount();
    const ok = await saveNow();
    if (ok !== false || snapshot() === savedSnapshot) showStatus("Den oprindelige prompt er hentet ind og gemt.");
  });
  // Gendan min standard: henter standardprompten ind i feltet og gemmer den med det samme
  $("resetPrompt").addEventListener("click", async () => {
    $("prompt").value = standardPrompt || DEFAULT_PROMPT; updatePromptCount();
    const ok = await saveNow();
    if (ok !== false || snapshot() === savedSnapshot) showStatus("Din standardprompt er hentet ind og gemt.");
  });
  // Sæt min standard: gemmer den nuværende tekst som standardprompt med det samme
  $("setStandard").addEventListener("click", async () => {
    const t = $("prompt").value.trim();
    if (!t) { showStatus("Prompten er tom og kan ikke sættes som standard.", { error: true }); return; }
    await saveNow();                   // en igangværende gemning må ikke overskrive beskeden nedenfor
    try {
      await chrome.storage.sync.set({ standardPrompt: t });
      standardPrompt = t;
      showStatus("Din standardprompt er sat.");
    } catch (e) {
      showStatus("Kunne ikke sætte standardprompten: " + (e.message || e), { error: true });
    }
  });

  // Tælleren opdateres løbende, mens siden er åben
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.tokenStats) showStats();
    if (area === "local" && changes.modelHealth) { health = changes.modelHealth.newValue || {}; updateHealth(); }
    // "Brugt i dag" for gratis Gemini og Groq følger også med
    if (area === "local" && (changes.freeUsage || changes.novaUsage || changes.openrouterUsage || changes.kiloUsage || changes.kiloKeyUsage || Object.keys(changes).some(k => k.startsWith("groqUsage")))) showFreeInfo();   // én pr. Groq-model
  });
  $("resetStats").addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ action: "resetTokenStats", provider: statsKeyOfChoice() });
      showStats();
      showStatus(`Forbrugstælleren for ${nameOf()} er nulstillet.`);
    } catch (e) {
      showStatus("Kunne ikke nulstille: " + (e.message || e), { error: true });
    }
  });

  $("clearCache").addEventListener("click", async () => {
    $("clearCache").disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ action: "clearCache" });
      if (r?.error) throw new Error(r.error);
      const n = r?.removed || 0;
      showStatus(n ? `${n.toLocaleString("da-DK")} gemte omskrivninger er slettet. Genindlæs nyhedssiden.`
        : "Der er ingen gemte omskrivninger.");
    } catch (e) {
      showStatus("Kunne ikke slette de gemte omskrivninger: " + (e.message || e), { error: true });
    } finally {
      $("clearCache").disabled = false;
    }
  });

  let testSeq = 0;   // Kun den nyeste test må vise sit resultat
  $("test").addEventListener("click", async () => {
    if (saveTimer || saving) await saveNow();   // en ny nøgle gemmes (og status nulstilles), før testen skriver sit resultat
    const s = readForm();
    // Navnet på den model, der testes, huskes – nameOf() læser altid det aktuelle valg
    const testedName = nameOf(), myTest = ++testSeq;
    // Resultatet vises under knappen, ikke i feltet øverst
    if (!s.apiKey && NEEDS_KEY(s.provider)) { showTest("err", "Ingen API-nøgle", "Indsæt en nøgle i feltet ovenfor."); return; }
    const mm = keyMismatch(s.provider, s.apiKey);
    if (mm) { showTest("err", "Ugyldig API-nøgle", mm); return; }
    showTest("busy", "Tester forbindelsen …");
    try {
      const res = await chrome.runtime.sendMessage({ action: "testAI", settings: s });
      if (myTest !== testSeq) return;   // en nyere test er startet – dette svar er forældet
      // Er udbyder eller model skiftet under testen, gælder resultatet ikke det nye valg –
      // forbindelsesstatus røres ikke, og resultatet viser navnet på den testede model
      if (res.error) { showTest("err", ...testError(res.error, s.provider)); if (/OLLAMA_ORIGINS/.test(res.error)) showOllamaOrigins(true); }
      else showTest("ok", "Forbindelsen virker", `${testedName} svarede: "${res.rewritten}"`);
      showFreeInfo(); // testen tæller også med i den gratis kvote
    } catch (e) {
      if (myTest !== testSeq) return;
      showTest("err", "Forbindelsen fejlede", "Kunne ikke kontakte baggrundsscript: " + e.message);
    }
  });
});


// ======================================================================
// Nyt design: forside med overblik, paneler fra højre, KPI-bokser, ringe og token-måler
// ======================================================================
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
const PANELS = {
  ai: { title: "AI", sub: "Udbyder, model og nøgle" },
  sites: { title: "Sider", sub: "Hvor unbAIt DK er aktiv" },
  hide: { title: "Skjul indhold", sub: "Emner, ord og elementer" },
  stats: { title: "Forbrug", sub: "" },
  prompt: { title: "Prompt", sub: "Instruktionen til AI'en" },
  help: { title: "Sådan virker det", sub: "", wide: true },
  log: { title: "Log", sub: "" },
  backup: { title: "Sikkerhedskopi", sub: "Gem og hent dine indstillinger" }
};
let currentPanel = null, lastTrigger = null, closeTimer = null;
const nf = (x) => Number(x || 0).toLocaleString("da-DK");
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Beskeder (✓ Gemt og statusboksen) følger med ind i panelet, så de ikke gemmer sig bag sløret
function moveNotices(open) {
  if (open) { $("dNotice").append($("status")); $("dSlot").append($("saved")); }
  else $("topSlot").append($("status"), $("saved"));
}
function updateDrawerSub() {
  if (currentPanel !== "stats") return;
  $("dSub").textContent = [PROVIDER_NAMES[currentProvider], nameOf()].filter(Boolean).join(" · ");
}
function openPanel(name, trigger) {
  const m = PANELS[name];
  if (!m) return;
  clearTimeout(closeTimer);
  currentPanel = name;
  if (trigger) lastTrigger = trigger;
  document.querySelectorAll("#drawer .panel").forEach(pn => { pn.hidden = pn.id !== "pnl-" + name; });
  $("dTitle").textContent = m.title;
  $("dSub").textContent = m.sub; $("dSub").hidden = !m.sub && name !== "stats";
  $("dIc").replaceChildren(panelIcon(name));
  $("drawer").classList.toggle("wide", !!m.wide);
  for (const e of [$("veil"), $("drawer")]) { e.classList.remove("closing"); e.hidden = false; }
  document.body.classList.add("locked");
  moveNotices(true);
  updateDrawerSub();
  $("drawer").scrollTop = 0;
  if (name === "log") { $("logSearch").value = ""; showLog(); }   // Søgningen huskes ikke
  if (name === "prompt") updateSuggestButtons();
  updateHome();
  $("dClose").focus({ preventScroll: true });
}
function closePanel() {
  if (!currentPanel) return;
  currentPanel = null;
  saveNow();
  const done = () => {
    $("veil").hidden = true; $("drawer").hidden = true;
    for (const e of [$("veil"), $("drawer")]) e.classList.remove("closing");
    document.body.classList.remove("locked");
    moveNotices(false);
    (lastTrigger || document.body).focus?.({ preventScroll: true });
  };
  clearTimeout(closeTimer);
  if (reduceMotion()) { done(); return; }
  for (const e of [$("veil"), $("drawer")]) e.classList.add("closing");
  closeTimer = setTimeout(done, 220);
}
function panelKeys(ev) {
  // Bekræftelsen ved gendannelse: Esc lukker kun den, og Tab bliver i den
  if (!$("bkVeil").hidden) {
    if (ev.key === "Escape") { ev.preventDefault(); closeBackupModal(); }
    else if (ev.key === "Tab") trapTab(ev, $("bkModal"), "button");
    return;
  }
  // Er forslagsmodalen åben, styrer den tastaturet (Esc lukker kun modalen; Tab bliver i den)
  if (!$("pmVeil").hidden) {
    if (ev.key === "Escape") { ev.preventDefault(); closeSuggest(); return; }
    if (ev.key === "Tab") trapTab(ev, $("pm"), "button");
    return;
  }
  if (!currentPanel) return;
  if (ev.key === "Escape") {
    const a = document.activeElement;
    // Esc i søgefeltet med tekst rydder kun søgningen; tomt felt -> panelet lukkes som normalt
    if (a && a.id === "logSearch" && a.value) { ev.preventDefault(); a.value = ""; showLog(); return; }
    try { if (a && a.matches && a.matches("select:open")) return; } catch {}
    ev.preventDefault(); closePanel(); return;
  }
  if (ev.key === "Tab") trapTab(ev, $("drawer"), 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');   // fokus bliver i panelet
}
// Tab og Shift+Tab bliver i boksen (panelet, forslagsmodalen eller bekræftelsen ved gendannelse): fra sidste til første og omvendt.
// Står fokus uden for boksen, går Tab til det første og Shift+Tab til det sidste
function trapTab(ev, box, selector) {
  const items = [...box.querySelectorAll(selector)].filter(x => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1], a = document.activeElement;
  if (!box.contains(a)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
  else if (ev.shiftKey && a === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
}

// ---- Forbindelsen (seneste test pr. udbyder og model; gemmes, til browseren lukkes) ----

// ---- Ring og måler ----
function ring(pct, label) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const c = 2 * Math.PI * 50;
  const w = el("div", "ring2"); w.setAttribute("role", "img"); w.setAttribute("aria-label", `${pct} % ${label}`);
  w.append(tpl("tplRing"));
  w.querySelector(".val").setAttribute("stroke-dasharray", `${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}`);
  const t = el("div", "rt"); t.append(el("b", "", pct + " %"), el("span", "", label)); w.append(t);
  return w;
}
const GAUGE_MAX = 1600;
// Klasserne hedder z-… (»lg« var også loglinjernes klasse, så »Fin længde« fik loggens gitter og streg)
function gaugeZone(t) { return t <= 500 ? ["z-dg", "Kort og effektiv"] : t <= 800 ? ["z-lg", "Fin længde"] : t <= 1200 ? ["z-y", "Tæt på grænsen"] : ["z-r", "For lang"]; }
function renderPromptKpi(words, tokens) {
  const k = $("kpiPrompt");
  if (!k.firstChild) {
    k.replaceChildren(tpl("tplPromptKpi"));
  }
  $("kpW").textContent = nf(words);
  $("kpT").textContent = `ca. ${nf(tokens)} tokens pr. kald`;
  const [cls, txt] = gaugeZone(tokens);
  $("needle").style.transform = `translate(100px,100px) rotate(${(Math.min(tokens, GAUGE_MAX) / GAUGE_MAX * 180).toFixed(1)}deg)`;
  $("gvTok").textContent = nf(tokens);
  $("gzTxt").className = "gz " + cls; $("gzTxt").textContent = txt;
  $("gaugeSvg").setAttribute("aria-label", `${nf(tokens)} tokens: ${txt}`);
}

// ---- Navnet på den valgte model står altid på én linje ----
function fitModelName() {
  const n = document.querySelector("#kpiAi .modelname");
  if (!n || !n.clientWidth) return;
  let fs = 38; n.style.fontSize = fs + "px";
  while (n.scrollWidth > n.clientWidth && fs > 18) { fs -= 1; n.style.fontSize = fs + "px"; }
}

// ---- Forsiden og KPI'erne ----
const modelShort = () => nameOf().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
function pills(items, max = 7) {
  const out = items.slice(0, max).map(t => el("span", "pill", t));
  if (items.length > max) out.push(el("span", "pill", `+${items.length - max}`));
  return out;
}
function hideInfo() {
  const h = readHide();
  const cats = h.hideCats.map(v => document.querySelector(`#hideCats input[value="${CSS.escape(v)}"]`)?.parentElement.textContent.trim()).filter(Boolean);
  const words = h.hideWords ? h.hideWords.split(",").map(w => w.trim()).filter(Boolean).map(w => `»${w}«`) : [];
  const elems = [h.hidePlus && "Ekstra Bladet +", h.hideAds && "Annoncer (Ekstra Bladet)", h.hideGames && "Spil", h.hideAdsAvisen && "Annoncer (Avisen.dk)", h.hideAdsAller && "Annoncer (Se og Hør og Billed-Bladet)", h.skipReelAds && "Reklamer i reels (Berlingske og B.T.)"].filter(Boolean);
  return { cats, words, elems, total: cats.length + words.length + elems.length, mode: h.hideMode === "dim" ? "vises som tynd linje" : "fjernes helt" };
}
// Forsiden genopbygges højst én gang pr. omgang – kaldene (tastetryk, udbyderskift, forbrug) samles i én kort pause
let homeTimer = null;
function updateHome() {
  if (homeTimer) return;
  homeTimer = setTimeout(() => { homeTimer = null; updateHomeNow(); }, 0);
}
function updateHomeNow() {
  if (!$("heroTitle") || !GROUPS || !Object.keys(GROUPS).length) return;
  const free = isTier(currentTier) && !orPaid(), local = isLocal(currentProvider) || currentProvider === "ollama";   // Ollama kører også lokalt
  const sites = [...document.querySelectorAll("#sites input[data-site]")];
  // JFM-medier er ét flueben, men tæller som de sider, det dækker (20)
  const weight = (i) => i.dataset.site === "jfm" ? ((typeof UNBAIT_SITES !== "undefined" && UNBAIT_SITES.find(x => x.id === "jfm")?.matches.length) || 1) : 1;
  const count = (list) => list.reduce((a, i) => a + weight(i), 0);
  const on = sites.filter(i => i.checked), n = count(on), total = count(sites);
  const short = modelShort(), full = nameOf();
  const hh = healthOfChoice(), hcls = hh.state === "err" ? " err" : hh.state === "old" ? " warn" : "";
  const hword = hh.state === "ok" ? "Forbindelsen virker" : healthWords(hh);

  // Hero
  const sp = el("span", "", "med " + short);
  $("heroTitle").replaceChildren(`Omskriver på ${n} ${n === 1 ? "side" : "sider"}`, document.createElement("br"), sp);
  const hc = $("heroConn");
  hc.hidden = hh.state === "none"; hc.className = "eyebrow" + hcls; hc.title = HEALTH_TITLE[hh.state];
  hc.lastChild.textContent = hword;
  let label, note = "", big, small = "", meter = null;
  if (local) { label = "Kører lokalt"; big = "Gratis"; small = "intet sendes ud"; }
  else if (!free) {
    label = "Estimeret omskrivninger pr. USD";
    const own = choice().custom && ownValid(group());   // eget model-id: prisen kendes ikke
    big = own ? "Pris ukendt" : paidPerUsd ? "≈ " + nf(paidPerUsd) : "Ingen kald endnu"; small = own ? "eget model-id" : "";
  }
  else {
    note = currentProvider === "gemini_free" ? "nulstilles ca. kl. 9" : "";
    const u = usage || { requests: 0, tokens: 0 }, L = readLimits(currentTier), uv = usedVsLimit(u, L);
    label = uv.label; big = nf(uv.used);
    small = isHourTier(currentTier) ? `/ ${nf(uv.limit)} kald` : `/ ${nf(L.rpd)} kald · ${nf(u.tokens)} tokens`;   // Kilo pr. time
    meter = uv.limit > 0 ? Math.min(100, uv.used / uv.limit * 100) : 0;
  }
  $("todayLabel").textContent = label; $("todayNote").textContent = note; $("todayBig").textContent = big; $("todaySmall").textContent = small;
  $("todayMeter").hidden = meter === null; if (meter !== null) $("todayMeter").firstChild.style.width = meter + "%";

  // Rækker
  const sumAi = [el("span", "big", PROVIDER_NAMES[chosenProvider()] || ""), el("span", "pill", short)];
  if (free) { const r = poolPicked().length; sumAi.push(el("span", "pill b", "Free tier"), el("span", "pill", `${r} ${r === 1 ? "reservemodel" : "reservemodeller"}`)); }
  $("sumAi").replaceChildren(...sumAi);
  $("sumSites").replaceChildren(el("span", "big", `${n} af ${total}`), ...pills(on.map(i => i.parentElement.textContent.trim()), 6));
  const hi = hideInfo();
  $("sumHide").replaceChildren(...(hi.total ? [...pills([...hi.cats, ...hi.words, ...hi.elems], 6), el("span", "dimt", "· " + hi.mode)] : [el("span", "dimt", "Intet skjules")]));
  const ss = lastStats, since = ss && ss.since ? new Date(ss.since) : null;
  document.querySelector("#rowStats .t span").textContent = since
    ? sinceText(since)
    : "Ingen kald endnu";
  if (!ss) $("sumStats").replaceChildren(el("span", "dimt", "Tallene dukker op ved det første kald"));
  else {
    const nodes = [el("span", "big", nf("ok" in ss ? ss.ok : ss.calls)), el("span", "dimt", "ok" in ss ? "godkendte omskrivninger" : "kald")];
    if ("retries" in ss) nodes.push(el("span", "dimt", `· ${nf(ss.retries)} genforsøg`));
    if (ss.timed) nodes.push(el("span", "dimt", `· ${speedText(ss)} sek. svartid`));
    $("sumStats").replaceChildren(...nodes);
  }
  const w = readWords(), pr = $("prompt").value.trim(), pw = wordCount(pr);
  $("sumPrompt").replaceChildren(el("span", "big", `${nf(pw)} ord`), el("span", "pill", `Højst ${Number.isNaN(w.first) ? "?" : w.first} ord`), el("span", "pill", `2. forsøg: ${Number.isNaN(w.retry) ? "?" : w.retry} ord`));

  // KPI: AI
  const left = el("div", "");
  left.append(el("div", "small", PROVIDER_NAMES[chosenProvider()] || ""));
  const mn = el("div", "modelname", short); mn.title = full; left.append(mn);
  if (hh.state !== "none") { const c = el("div", "conn" + hcls); c.title = HEALTH_TITLE[hh.state]; c.append(document.createElement("i"), hword); left.append(c); }
  const kai = [left];
  if (free) { const u = usage || { requests: 0 }, uv = usedVsLimit(u, readLimits(currentTier)); kai.push(ring(uv.limit > 0 ? Math.round(uv.used / uv.limit * 100) : 0, uv.ring)); }
  $("kpiAi").replaceChildren(...kai);
  fitModelName();
  // KPI: Sider
  const ks = el("div", ""); ks.append(el("div", "num", String(n)), el("div", "lbl", "aktive nyhedssider"), el("div", "sub2", `af ${total} mulige`));
  $("kpiSites").replaceChildren(ks, ring(total ? Math.round(n / total * 100) : 0, "aktive"));
  document.querySelectorAll("[data-group]").forEach(g => {
    const all = g.querySelectorAll("input[data-site]");
    const c = document.querySelector(`[data-cnt="${g.dataset.group}"]`);
    if (c) c.textContent = `${count([...all].filter(i => i.checked))} af ${count([...all])}`;
  });
  // KPI: Skjul indhold
  const kh = el("div", ""); kh.append(el("div", "num", String(hi.total)), el("div", "lbl", "ting skjules"), el("div", "sub2", `${hi.cats.length} ${hi.cats.length === 1 ? "emne" : "emner"} · ${hi.words.length} ord · ${hi.elems.length} ${hi.elems.length === 1 ? "element" : "elementer"} · ${hi.mode}`));
  $("kpiHide").replaceChildren(kh);
}


// ======================================================================
// »Få forslag til prompten«. Den valgte model vurderer
// prompten; svaret vises i en modal med Vurdering, Ændringsforslag og Foreslået prompt. »Brug forslag« gemmer den
// tidligere prompt (promptPrevious), så »Fortryd: gendan forrige prompt« kan sætte den tilbage. Ikke med Chromes
// indbyggede AI.
// ======================================================================
let suggestSeq = 0, suggestion = null, suggestFrom = null;
async function updateSuggestButtons() {
  const local = currentProvider === "chrome_local";
  $("suggestPrompt").disabled = local;
  $("suggestPrompt").title = local ? "Ikke muligt med Chromes indbyggede AI" : "";
  const { promptPrevious } = await chrome.storage.local.get("promptPrevious").catch(() => ({}));
  $("undoPrompt").hidden = typeof promptPrevious !== "string";
}
function closeSuggest() {
  suggestSeq++;   // et svar, der stadig er på vej, vises ikke
  $("pmVeil").hidden = true;
  (suggestFrom || $("suggestPrompt")).focus({ preventScroll: true });
}
function renderSuggest(state, data = {}) {
  const body = $("pmBody"); body.replaceChildren();
  $("pmUse").disabled = $("pmCopy").disabled = state !== "ok" || !data.prompt;
  if (state === "busy") {   // Animerede prikker i stedet for »…«
    const p = el("p", "", `Henter forslag fra ${data.model}`), d = el("span", "dots"); d.setAttribute("aria-hidden", "true");
    p.append(d); body.append(p); return;
  }
  if (state === "err") { body.append(el("p", "err", "Kunne ikke hente forslag: " + data.error)); return; }
  body.append(el("h3", "", "Vurdering"), el("p", "", data.vurdering || "–"));
  body.append(el("h3", "", "Ændringsforslag"));
  if (data.forslag?.length) {
    const ol = el("ol", "");
    for (const f of data.forslag) { const li = el("li", "", f.aendring); if (f.begrundelse) li.append(" ", el("span", "why", "– " + f.begrundelse)); ol.append(li); }
    body.append(ol);
  } else body.append(el("p", "", data.unparsed ? "Svaret kunne ikke læses som forslag. Prøv igen, eller vælg en anden model." : "Ingen ændringer foreslået."));
  if (data.prompt) {
    body.append(el("h3", "", "Foreslået prompt"), el("pre", "", data.prompt));
    body.append(el("div", "warn", "Når du bruger forslaget, bliver alle gemte omskrivninger lavet om, næste gang du besøger siderne, fordi prompten er ændret. Det koster nye kald – også mod de gratis grænser. Din nuværende prompt gemmes, så du kan fortryde."));
  }
}
function initPromptSuggest() {
  $("suggestPrompt").addEventListener("click", async () => {
    if (currentProvider === "chrome_local") return;
    const my = ++suggestSeq, model = nameOf() || PROVIDER_NAMES[currentProvider] || "";
    suggestion = null; suggestFrom = $("suggestPrompt");
    $("pmSub").textContent = `Fra ${model} · ordgrænser ${$("maxFirst").value} / ${$("maxRetry").value}`;
    renderSuggest("busy", { model });
    $("pmVeil").hidden = false; $("pm").focus({ preventScroll: true });
    let res;
    try {
      await saveNow();   // modellen og nøglen, der står i formularen, er dem, der bruges
      res = await chrome.runtime.sendMessage({ action: "suggestPrompt", prompt: $("prompt").value.trim() || DEFAULT_PROMPT,
        maxWordsFirst: $("maxFirst").value, maxWordsRetry: $("maxRetry").value });
    } catch (e) { res = { error: e.message || String(e) }; }
    if (my !== suggestSeq) return;   // lukket eller startet igen imens
    showFreeInfo();
    if (!res || res.error) { renderSuggest("err", { error: testError(res?.error || "intet svar", currentProvider).join(": ") }); return; }
    suggestion = res;
    renderSuggest("ok", res);
    $("pmClose").focus({ preventScroll: true });
  });
  $("pmClose").addEventListener("click", closeSuggest);
  $("pmVeil").addEventListener("click", (e) => { if (e.target === $("pmVeil")) closeSuggest(); });
  $("pmCopy").addEventListener("click", async () => {
    if (!suggestion?.prompt) return;
    try { await navigator.clipboard.writeText(suggestion.prompt); showStatus("Forslaget er kopieret."); }
    catch (e) { showStatus("Kunne ikke kopiere forslaget: " + (e.message || e), { error: true }); }
  });
  $("pmUse").addEventListener("click", async () => {
    if (!suggestion?.prompt) return;
    await chrome.storage.local.set({ promptPrevious: $("prompt").value });
    $("prompt").value = suggestion.prompt; updatePromptCount();
    closeSuggest();
    await saveNow();
    await updateSuggestButtons();
    showStatus("Forslaget bruges nu som prompt. »Fortryd: gendan forrige prompt« sætter den gamle tilbage.");
  });
  $("undoPrompt").addEventListener("click", async () => {
    const { promptPrevious } = await chrome.storage.local.get("promptPrevious");
    if (typeof promptPrevious !== "string") return;
    $("prompt").value = promptPrevious; updatePromptCount();
    await chrome.storage.local.remove("promptPrevious");
    await saveNow();
    await updateSuggestButtons();
    showStatus("Den forrige prompt er sat tilbage.");
  });
  $("provider").addEventListener("change", updateSuggestButtons);
  updateSuggestButtons();
}


// ======================================================================
// Besked om ny version. Vises øverst på forsiden, når release-repoet har en
// nyere version end den installerede, og brugeren ikke har trykket »Senere« for netop den version. Er udvidelsen
// indlæst fra en git-mappe (.git/HEAD kan læses), vises git-vejledningen; ellers zip-vejledningen med knappen
// »Hent version …«. Ingen indstilling – det afgøres automatisk.
// ======================================================================
async function isGitFolder() {
  try { const r = await fetch(chrome.runtime.getURL(".git/HEAD"), { cache: "no-store" }); return r.ok && /^ref:|^[0-9a-f]{40}/.test((await r.text()).trim()); } catch { return false; }
}
async function initUpdateNotice() {
  let info;
  try { info = await chrome.runtime.sendMessage({ action: "updateInfo" }); } catch { return; }
  if (!info?.latest || !info.current || cmpVersion(info.latest, info.current) <= 0) return;
  const { updateDismissed } = await chrome.storage.local.get("updateDismissed").catch(() => ({}));
  if (updateDismissed === info.latest) return;
  const git = await isGitFolder();
  const nyt = info.notes ? ` Nyt: ${info.notes.replace(/\s+$/, "")}${/[.!?]$/.test(info.notes.trim()) ? "" : "."}` : "";
  $("updTitle").textContent = `Ny version ${info.latest} er klar`;
  const t = $("updText"); t.replaceChildren(`Du har ${info.current}.${nyt} `);
  if (git || !info.zip) {
    if (git) { t.append("unbAIt DK er indlæst fra en git-mappe: kør "); t.append(el("code", "", "git pull")); t.append(" i mappen, og tryk på genindlæs på chrome://extensions."); }
    $("updGet").hidden = true;
  } else {
    t.append("Hent zip-filen, pak den ud over den gamle mappe, og tryk på genindlæs på chrome://extensions.");
    $("updGet").textContent = `Hent version ${info.latest}`; $("updGet").hidden = false;
    $("updGet").onclick = () => { if (UPDATE_ZIP.test(info.zip)) window.open(info.zip, "_blank", "noopener"); };   // UPDATE_ZIP i shared.js
  }
  $("updLater").onclick = async () => { await chrome.storage.local.set({ updateDismissed: info.latest }).catch(warnErr("Senere")); $("upd").hidden = true; };
  $("upd").hidden = false;
}


// ======================================================================
// Sikkerhedskopi (filendelse .unbait).
// Filen: første linje »unbAIt DK backup 1«, derefter indholdet som base64 (sløret, ikke krypteret).
// Med: alt i storage.sync (udbyder, modeller, pulje, sider, Skjul indhold, prompt, standardprompt, ordgrænser …),
// grænserne for gratis kald (…Limits i storage.local) og »Behold originalen« (keptArticles). API-nøgler kun med
// flueben. Ikke med: cache, log, forbrug, pauser. Gendannelse erstatter indstillingerne efter en bekræftelse;
// er nøglerne ikke med i filen, beholdes de nuværende.
// ======================================================================
const BK_HEAD = "unbAIt DK backup 1";
const isLimitKey = (k) => /Limits(:|$)/.test(k);
const b64enc = (str) => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
const bkDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const bkDay = (t) => new Date(t).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
let bkPending = null;

async function makeBackup(withKeys) {
  const sync = await chrome.storage.sync.get(null);
  const local = await chrome.storage.local.get(null);
  const data = { format: 1, app: "unbAIt DK", version: chrome.runtime.getManifest().version_name, savedAt: new Date().toISOString(), sync,
    local: Object.fromEntries(Object.entries(local).filter(([k]) => isLimitKey(k) || k === "keptArticles")) };
  if (withKeys && local.apiKeys && Object.keys(local.apiKeys).length) data.apiKeys = local.apiKeys;
  return BK_HEAD + "\n" + b64enc(JSON.stringify(data)) + "\n";
}
function readBackup(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] !== BK_HEAD) throw new Error("Filen er ikke en sikkerhedskopi fra unbAIt DK.");
  let data;
  try { data = JSON.parse(b64dec(lines.slice(1).join(""))); } catch { throw new Error("Sikkerhedskopien er beskadiget og kan ikke læses."); }
  if (!data || data.format !== 1 || typeof data.sync !== "object" || !data.sync) throw new Error("Sikkerhedskopien er beskadiget og kan ikke læses.");
  if (data.local && typeof data.local !== "object") data.local = {};
  if (data.apiKeys && typeof data.apiKeys !== "object") delete data.apiKeys;
  return data;
}
async function updateBackupRow() {
  const { backupSavedAt } = await chrome.storage.local.get("backupSavedAt").catch(() => ({}));
  $("sumBackup").replaceChildren(el("span", "", backupSavedAt ? `Senest gemt ${bkDay(backupSavedAt)}` : "Ingen gemt endnu"));
}
function closeBackupModal() { $("bkVeil").hidden = true; bkPending = null; $("bkPick").focus({ preventScroll: true }); }
async function showRestore(data) {
  const s = data.sync || {}, L = data.local || {};
  const siteName = (id) => UNBAIT_SITES.find(x => x.id === id)?.name || id;
  const sites = Array.isArray(s.sites) ? s.sites : DEFAULT_SITES;
  // Sider, Chrome skal give lov til igen (alt andet end de indbyggede)
  const missing = [];
  for (const id of sites) { const st = UNBAIT_SITES.find(x => x.id === id); if (st && !st.builtin && !(await chrome.permissions.contains({ origins: st.matches }).catch(() => false))) missing.push(st); }
  const catName = (c) => document.querySelector(`#hideCats input[value="${CSS.escape(c)}"]`)?.closest("label")?.textContent.trim() || c;
  const hide = [...(s.hideCats || []).map(catName), s.hidePlus && "Ekstra Bladet +", s.hideAds && "Annoncer (EB)", s.hideAdsAvisen && "Annoncer (Avisen.dk)", s.hideAdsAller && "Annoncer (Se og Hør og Billed-Bladet)", s.skipReelAds && "Reklamer i reels (Berlingske og B.T.)", s.hideGames && "Spil (B.T.)"].filter(Boolean);
  const words = String(s.hideWords || "").split(",").map(w => w.trim()).filter(Boolean).length;
  if (words) hide.push(`${words} egne ord`);
  const pool = Array.isArray(s.pool) ? s.pool.length : 0;
  const prompt = typeof s.prompt === "string" && s.prompt.trim() && s.prompt.trim() !== DEFAULT_PROMPT.trim() ? `din egen (${s.prompt.trim().length} tegn)` : "standard";
  const kept = Object.keys(L.keptArticles || {}).length;
  const keys = data.apiKeys ? Object.keys(data.apiKeys).filter(k => data.apiKeys[k]) : [];
  const items = [
    `Udbyder: ${PROVIDER_NAMES[s.provider] || s.provider || "standard"}` + (pool ? ` · puljen: ${pool} ${pool === 1 ? "model" : "modeller"}` : ""),
    `Sider: ${sites.length} (${sites.map(siteName).join(", ")})`,
    `Skjul indhold: ${hide.length ? hide.join(" · ") : "intet"}`,
    `Prompt: ${prompt} · ordgrænser ${s.maxWordsFirst ?? MAX_WORDS_FIRST} / ${s.maxWordsRetry ?? MAX_WORDS_RETRY}`,
    `»Behold originalen«: ${kept} ${kept === 1 ? "artikel" : "artikler"}`,
    keys.length ? `API-nøgler: med (${keys.map(k => PROVIDER_NAMES[k] || k).join(", ")})` : "API-nøgler: ikke med – dine nuværende nøgler beholdes"
  ];
  $("bkList").replaceChildren(...items.map(t => el("li", "", t)));
  $("bkSub").textContent = `Fra unbAIt DK ${data.version || "?"}` + (data.savedAt ? ` · gemt ${new Date(data.savedAt).toLocaleString("da-DK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : "");
  $("bkWarn").textContent = "Dine nuværende indstillinger bliver erstattet." + (missing.length
    ? ` Chrome skal give lov til ${missing.length} ${missing.length === 1 ? "side" : "sider"} igen (${missing.map(x => x.name).join(" og ")}) – det beder unbAIt DK om bagefter.` : "");
  bkPending = { data, missing };
  $("bkVeil").hidden = false; $("bkCancel").focus({ preventScroll: true });
}
// Det, en sikkerhedskopi må sætte i storage.sync (nøglerne i dokumentationens afsnit 2) og værdiernes type.
// Ukendte nøgler, forkerte typer og en udbyder, der ikke findes, springes over (resten gendannes).
const SYNC_TYPES = { enabled: "boolean", provider: "string", openaiModel: "string", openrouterModel: "string", groqModel: "string", ollamaModel: "string", customModels: "object", pool: "array",
  prompt: "string", standardPrompt: "string", maxWordsFirst: "number", maxWordsRetry: "number", sites: "array", hideCats: "array",
  hidePlus: "boolean", hideAds: "boolean", hideAdsAvisen: "boolean", hideAdsAller: "boolean", skipReelAds: "boolean", hideGames: "boolean", hideWords: "string", hideMode: "string" };
function cleanSync(sync) {
  const out = {};
  for (const [k, t] of Object.entries(SYNC_TYPES)) {
    const v = sync[k];
    if (t === "array" ? Array.isArray(v) : typeof v === t) out[k] = v;
  }
  if ("provider" in out && !isProvider(out.provider)) delete out.provider;
  // Eget model-id: kun kendte udbydere med { id: gyldigt id, on: true/false }
  if ("customModels" in out) {
    const cm = out.customModels && !Array.isArray(out.customModels) ? out.customModels : {};
    out.customModels = Object.fromEntries(CUSTOM_MODEL_PROVIDERS.filter(p => cm[p] && CUSTOM_ID_RE.test(String(cm[p].id || "")))
      .map(p => [p, { id: String(cm[p].id), on: cm[p].on === true }]));
  }
  return out;
}
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
async function doRestore() {
  if (!bkPending) return;
  const { data, missing } = bkPending;
  const sync = cleanSync(data.sync);
  if (!Object.keys(sync).length) throw new Error("Sikkerhedskopien indeholder ingen indstillinger, der kan gendannes.");
  // Chromes tilladelse skal bedes om med det samme (klikket på »Gendan« tæller som brugerens handling)
  let granted = true;
  if (missing.length) granted = await chrome.permissions.request({ origins: missing.flatMap(x => x.matches) }).catch(() => false);
  // Først skrives det nye, derefter fjernes det, der ikke er i kopien. Fejler skrivningen (fx sync-lagerets
  // kvote), er intet ændret, og de nuværende indstillinger står urørt.
  const before = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set(sync);
  const stale = Object.keys(before).filter(k => !(k in sync));
  if (stale.length) await chrome.storage.sync.remove(stale);
  const localNew = Object.fromEntries(Object.entries(data.local || {}).filter(([k, v]) => (isLimitKey(k) || k === "keptArticles") && isObj(v)));
  const local = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(local).filter(k => isLimitKey(k) || k === "keptArticles"));
  await chrome.storage.local.set(localNew);
  if (isObj(data.apiKeys)) await chrome.storage.local.set({ apiKeys: Object.fromEntries(Object.entries(data.apiKeys).filter(([, v]) => typeof v === "string")) });
  await chrome.storage.local.set({ backupRestored: { at: Date.now(), missingDenied: granted ? [] : missing.map(x => x.name) } });
  location.reload();   // siden læser de gendannede indstillinger forfra
}
function initBackup() {
  $("bkName").textContent = `unbaitdk-backup-${bkDate()}.unbait`;
  $("bkKeys").addEventListener("change", () => { $("bkKeysWarn").hidden = !$("bkKeys").checked; });
  $("bkSave").addEventListener("click", async () => {
    try {
      await saveNow();
      const text = await makeBackup($("bkKeys").checked);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
      a.download = `unbaitdk-backup-${bkDate()}.unbait`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      await chrome.storage.local.set({ backupSavedAt: Date.now() });
      updateBackupRow();
      showStatus("Sikkerhedskopien er gemt.");
    } catch (e) { showStatus("Kunne ikke gemme sikkerhedskopien: " + (e.message || e), { error: true }); }
  });
  $("bkPick").addEventListener("click", () => { $("bkFile").value = ""; $("bkFile").click(); });
  $("bkFile").addEventListener("change", async () => {
    const f = $("bkFile").files?.[0];
    if (!f) return;
    $("bkFile").value = "";   // samme fil kan vælges igen efter »Annullér«
    try { await showRestore(readBackup(await f.text())); }
    catch (e) { showStatus(e.message || String(e), { error: true }); }
  });
  $("bkCancel").addEventListener("click", closeBackupModal);
  $("bkVeil").addEventListener("click", (e) => { if (e.target === $("bkVeil")) closeBackupModal(); });
  $("bkDo").addEventListener("click", () => { doRestore().catch(e => showStatus("Kunne ikke gendanne: " + (e.message || e), { error: true })); });
  updateBackupRow();
  // Efter gendannelse (siden er genindlæst): besked
  chrome.storage.local.get("backupRestored").then(({ backupRestored: r }) => {
    if (!r || Date.now() - r.at > 60000) return;
    chrome.storage.local.remove("backupRestored");
    showStatus("Sikkerhedskopien er gendannet." + (r.missingDenied?.length ? ` Chrome gav ikke lov til ${r.missingDenied.join(" og ")} – sæt flueben under Sider igen for at prøve igen.` : ""), { error: !!r.missingDenied?.length });
  }).catch(warnErr("besked om gendannelse"));
}
