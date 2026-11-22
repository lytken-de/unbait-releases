// Indstillingssidens tema: lyst eller mørkt gemmes i localStorage i denne browser; uden gemt tema følges systemet.
// Indlæses i <head>, så siden tegnes i det rigtige tema fra starten. Knappen #themeBtn skifter mellem lyst og mørkt.
(() => {
  const KEY = "unbaitTheme", root = document.documentElement, sys = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => {
    try { const t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : null; }
    catch { return null; }   // lageret kan være blokeret: så følges systemet
  };
  const label = () => {
    const b = document.getElementById("themeBtn"); if (!b) return;
    const t = root.dataset.theme === "dark" ? "Skift til lyst tema" : "Skift til mørkt tema";
    b.title = t; b.setAttribute("aria-label", t);
  };
  const apply = () => { root.dataset.theme = saved() || (sys.matches ? "dark" : "light"); label(); };
  apply();
  sys.addEventListener("change", apply);          // uden eget valg skifter siden med systemet
  addEventListener("storage", (e) => { if (e.key === KEY) apply(); });   // valget i en anden fane
  document.addEventListener("DOMContentLoaded", () => {
    label();
    document.getElementById("themeBtn").addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); }
      catch { /* blokeret lager: skiftet gælder, til siden lukkes */ }
      root.dataset.theme = next; label();
    });
  });
})();
