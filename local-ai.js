// Skjult extension-dokument (offscreen), der kører Chromes indbyggede AI, hvis
// LanguageModel ikke er tilgængeligt direkte i baggrundsscriptet. Sprogvalg og opstart står i shared.js.
let base = null, basePrompt = null;

async function prompt(system, user) {
  if (typeof LanguageModel === "undefined") throw new Error("Chromes indbyggede AI findes ikke i denne Chrome-version");
  if (!base || basePrompt !== system) {
    base?.destroy?.(); base = null;
    const r = await createLocalSession(system);
    if (!r.session) throw r.lastErr || new Error("Chromes indbyggede AI er ikke tilgængelig");
    base = r.session;
    basePrompt = system;
  }
  const s = await base.clone();
  try { return await s.prompt(user); } finally { s.destroy?.(); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "local-ai") return false;
  const p = msg.action === "localAvailability" ? localModelState().then(({ state, danish, error }) => ({ state, danish, error }))
    : prompt(msg.system, msg.user).then(text => ({ text }));
  p.then(sendResponse, e => sendResponse({ error: e.message || String(e), state: "unavailable" }));
  return true;
});
