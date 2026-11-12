"use strict";
// Skjult extension-dokument (offscreen), der kører Chromes indbyggede AI, hvis
// LanguageModel ikke er tilgængeligt direkte i baggrundsscriptet. Sprogvalg, opstart og sessionen står i shared.js.
const localPrompt = localSessionCache();   // v1.97: samme hjælper som baggrunden (shared.js)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "local-ai") return false;
  const p = msg.action === "localAvailability" ? localModelState().then(({ state, danish, error }) => ({ state, danish, error }))
    : localPrompt(msg.system, msg.user).then(text => ({ text }));
  p.then(sendResponse, e => sendResponse({ error: e.message || String(e), state: "unavailable" }));
  return true;
});
