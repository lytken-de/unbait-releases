// Indstillinger (v1.43): ord som mærker (chips) og valgknapper for visning af skjult indhold.
// De rigtige felter (#hideWords og #hideMode) er skjulte og bruges stadig af options.js.
// Ligger i sin egen fil, fordi Chrome ikke kører scripts direkte i HTML på udvidelsens sider.
(() => {
  const words = document.getElementById("hideWords");
  const box = document.getElementById("hideTags");
  const input = document.getElementById("hideTagInput");
  const mode = document.getElementById("hideMode");
  const radios = [...document.querySelectorAll('input[name="hideModeRadio"]')];

  const split = s => (s || "").split(",").map(w => w.trim()).filter(Boolean);
  const chips = () => [...box.querySelectorAll(".tag")].map(t => t.dataset.word);

  function addChip(word) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.dataset.word = word;
    tag.append(document.createTextNode(word));
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = `Fjern "${word}"`;
    x.setAttribute("aria-label", `Fjern ${word}`);
    x.addEventListener("click", () => { tag.remove(); write(); input.focus(); });
    tag.append(x);
    box.insertBefore(tag, input);
  }

  // Det skjulte felt = mærkerne + det, der står i feltet endnu (så et ord, der kun er skrevet, også bliver gemt)
  function write() {
    words.value = [...chips(), ...split(input.value)].join(", ");
    words.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function commit() {
    const add = split(input.value);
    if (!add.length) { input.value = ""; return; }
    add.forEach(addChip);
    input.value = "";
    write();
  }
  function render() {
    box.querySelectorAll(".tag").forEach(t => t.remove());
    input.value = "";
    split(words.value).forEach(addChip);
    radios.forEach(r => { r.checked = r.value === mode.value; });
  }

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
  });
  input.addEventListener("input", () => { if (input.value.includes(",")) commit(); else write(); });
  input.addEventListener("blur", commit);
  box.addEventListener("click", e => { if (e.target === box) input.focus(); });

  radios.forEach(r => r.addEventListener("change", () => {
    if (!r.checked) return;
    mode.value = r.value;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  }));

  // options.js giver besked, når de gemte værdier er sat ind
  document.addEventListener("unbait:hide-shown", render);
  render();
})();

