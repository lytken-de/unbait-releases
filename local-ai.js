// Skjult extension-dokument (offscreen), der kører Chromes indbyggede AI, hvis
// LanguageModel ikke er tilgængeligt direkte i baggrundsscriptet.
const LANG_OPTIONS = [
  { expectedInputs: [{ type: "text", languages: ["da"] }], expectedOutputs: [{ type: "text", languages: ["da"] }] },
  {}
];
let base = null, basePrompt = null;

async function availability() {
  if (typeof LanguageModel === "undefined") return { state: "unavailable", error: "Chromes indbyggede AI findes ikke i denne Chrome-version" };
  for (const o of LANG_OPTIONS) {
    try { const state = await LanguageModel.availability(o); if (state !== "unavailable") return { state, danish: !!o.expectedInputs }; } catch {}
  }
  return { state: "unavailable" };
}

async function prompt(system, user) {
  if (typeof LanguageModel === "undefined") throw new Error("Chromes indbyggede AI findes ikke i denne Chrome-version");
  if (!base || basePrompt !== system) {
    base?.destroy?.(); base = null;
    let lastErr;
    for (const o of LANG_OPTIONS) {
      try {
        const state = await LanguageModel.availability(o);
        if (state === "unavailable") { lastErr = new Error("Chromes indbyggede AI kan ikke køre på denne computer"); continue; }
        if (state !== "available") throw new Error("Chromes indbyggede AI er ikke hentet endnu – tryk 'Hent model' i indstillingerne");
        base = await LanguageModel.create({ ...o, initialPrompts: [{ role: "system", content: system }] });
        break;
      } catch (e) { lastErr = e; if (!/NotSupported/i.test(e.name + e.message)) throw e; }
    }
    if (!base) throw lastErr || new Error("Chromes indbyggede AI er ikke tilgængelig");
    basePrompt = system;
  }
  const s = await base.clone();
  try { return await s.prompt(user); } finally { s.destroy?.(); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "local-ai") return false;
  const p = msg.action === "localAvailability" ? availability()
    : prompt(msg.system, msg.user).then(text => ({ text }));
  p.then(sendResponse, e => sendResponse({ error: e.message || String(e), state: "unavailable" }));
  return true;
});

