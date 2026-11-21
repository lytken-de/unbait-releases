// »Spring reklamer over i reels« (kun Berlingske og B.T.; indstillingen skipReelAds).
// Kører i sidens egen verden (world MAIN) fra document_start på berlingske.dk og bt.dk og registreres kun, når
// indstillingen er slået til (syncReelAdScripts i background.js).
//
// Reel-afspilleren (/video/reels/…) låser scrollningen på et reklamefelt og venter på, at reklamesystemet melder klar
// (window.google.ima og window.videoBidding.isReady). Kommer det aldrig (fx fordi en adblocker stopper det), opgiver
// afspilleren først efter 15 sekunder. Her melder et stand-in-reklamesystem klar med det samme og svarer »ingen
// reklame«, når afspilleren beder om en. Så markerer afspilleren pladsen som fejlet, springer selv forbi den og henter
// flere videoer. Uden adblocker vises reklamerne i reels heller ikke.
//
// Siderne skifter side uden genindlæsning (fra forsiden til en reel), så scriptet kører på hele domænet, men
// stand-in'et gælder kun, mens adressen er /video/reels/…; ellers ses sidens rigtige objekter uændret.
(() => {
  "use strict";
  if (window.__unbaitReelAds) return;
  Object.defineProperty(window, "__unbaitReelAds", { value: true });
  const onReels = () => /^\/video\/reels(\/|$)/.test(location.pathname);

  // Kun de dele af Googles IMA, afspilleren bruger, før den beder om en reklame (uden dem går siden ned)
  const types = (...names) => Object.fromEntries(names.map(n => [n, n.toLowerCase()]));
  class Listeners { addEventListener() {} removeEventListener() {} destroy() {} }
  const IMA = {
    settings: { setLocale() {}, setDisableCustomPlaybackForIOS10Plus() {} },
    AdDisplayContainer: class { initialize() {} destroy() {} },
    AdsLoader: class extends Listeners { requestAds() {} contentComplete() {} },
    AdsRequest: class { setAdWillAutoPlay() {} setAdWillPlayMuted() {} },
    AdsRenderingSettings: class {},
    AdEvent: { Type: types("AD_PROGRESS", "ALL_ADS_COMPLETED", "CONTENT_PAUSE_REQUESTED", "CONTENT_RESUME_REQUESTED", "LOADED", "PAUSED", "RESUMED", "SKIPPED", "STARTED") },
    AdErrorEvent: { Type: types("AD_ERROR") },
    AdsManagerLoadedEvent: { Type: types("ADS_MANAGER_LOADED") },
    VideoOrientation: { UNSET: 0 },
    ViewMode: { NORMAL: "normal", FULLSCREEN: "fullscreen" }
  };
  // Svaret »ingen reklame« (preroll: null): afspilleren opgiver pladsen uden en fejl i konsollen (et svar med error blev
  // til en uhåndteret fejl).
  // Sidens eget reklamescript skriver sin egen requestTagAsync ind i objektet (også med adblocker). Den svarer
  // aldrig, og afspilleren ville vente 3 sekunder. Felterne er derfor låst: det, siden skriver, ignoreres her og
  // gemmes i pageBidding, som siden får uden for reels
  // Svaret venter, til afspilleren har låst på reklamefeltet (data-scroll-locked="true"), dog højst NO_AD_WAIT_MS.
  // Afspilleren låser selv op og scroller videre, når en reklame fejler, mens feltet er aktivt. Fejler den i de første
  // millisekunder, før feltet er aktivt, kan afspilleren låse bagefter uden at låse op igen (siden starter med en reklame)
  const NO_AD_WAIT_MS = 1500, POLL_MS = 50;
  const noAd = () => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => document.querySelector('[data-scroll-locked="true"]') || performance.now() - t0 >= NO_AD_WAIT_MS
      ? resolve({ preroll: null }) : setTimeout(tick, POLL_MS);
    tick();
  });
  let pageBidding;
  const BIDDING = {};
  for (const [k, v] of [["isReady", true], ["requestTagAsync", noAd]]) {
    Object.defineProperty(BIDDING, k, { enumerable: true, get: () => v, set: (x) => { (pageBidding ||= {})[k] = x; } });
  }

  // videoBidding: på reel-siderne stand-in'et; ellers sidens eget (gemmes, når siden sætter det)
  let realBidding = window.videoBidding;
  Object.defineProperty(window, "videoBidding", {
    configurable: true,
    get: () => onReels() ? BIDDING : (realBidding ?? pageBidding),
    set: (v) => { if (v !== BIDDING) realBidding = v; }
  });

  // google: sidens eget, hvis det har IMA. Mangler IMA på en reel-side, gives et objekt med stand-in'et. Indlæses den
  // rigtige IMA bagefter (uden adblocker), lander den på det objekt; den gemmes og bruges så også uden for reels
  let realGoogle = window.google, view = null, viewFor;
  const realIma = (g) => g && Object.prototype.hasOwnProperty.call(g, "ima") && g.ima && g.ima !== IMA ? g.ima : null;
  Object.defineProperty(window, "google", {
    configurable: true,
    get: () => {
      const landed = realIma(view);
      if (landed && !realGoogle?.ima) { if (realGoogle) realGoogle.ima = landed; else realGoogle = { ima: landed }; }
      if (!onReels() || realGoogle?.ima) return realGoogle;
      if (!view || viewFor !== realGoogle) {
        viewFor = realGoogle;
        view = Object.create(realGoogle || null, { ima: { value: IMA, writable: true, enumerable: true, configurable: true } });
      }
      return view;
    },
    set: (v) => { if (v !== view) realGoogle = v; }
  });
})();
