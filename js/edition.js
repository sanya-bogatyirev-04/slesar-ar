// Версия оформления: «classic» (обычная, по умолчанию) или «adult» — режим «Для опытных»
// (реалистичная техника, звуки стройки, характерные реплики). Включается тумблером,
// выбор запоминается в localStorage.
// На расчёт модели версия не влияет.
const KEY = "slesar-ar-edition-v1";
const EDITIONS = ["classic", "adult"];

export const EDITION_CFG = {
  classic: { sfxSet: "toy",  linesSet: "classic", voiceMinGap: 5.0, linesPerMin: 10, bubbleStyle: "comic", sceneStyle: "polite" },
  adult:   { sfxSet: "real", linesSet: "adult",   voiceMinGap: 3.5, linesPerMin: 16, bubbleStyle: "rough", sceneStyle: "rude" },
};

function readStored() {
  try { const v = localStorage.getItem(KEY); return EDITIONS.includes(v) ? v : null; } catch (e) { return null; }
}
function store(ed) {
  try { localStorage.setItem(KEY, ed); } catch (e) { /* приватный режим — просто не запомним */ }
}

// стартовое значение: ?edition=pro | ?edition=classic (старое ?edition=18 тоже) → иначе сохранённое → иначе обычная
function initial() {
  const q = new URLSearchParams(location.search).get("edition");
  if (q) {
    const ed = /^(pro|adult|18|18\+)$/i.test(q) ? "adult" : "classic";
    store(ed);
    return ed;
  }
  return readStored() || "classic";
}

let current = initial();
const listeners = new Set();
const toggles = new Set();
document.documentElement.dataset.edition = current;

export const getEdition = () => current;

export function setEdition(ed) {
  if (!EDITIONS.includes(ed)) ed = "classic";
  store(ed);
  document.documentElement.dataset.edition = ed;
  for (const t of toggles) t.checked = ed === "adult";
  if (ed === current) return;
  current = ed;
  for (const cb of listeners) cb(ed);
}

export function onEditionChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// чекбокс-тумблер ↔ состояние; все тумблеры страницы всегда синхронны
export function bindToggle(input) {
  if (!input) return;
  toggles.add(input);
  input.checked = current === "adult";
  input.addEventListener("change", () => setEdition(input.checked ? "adult" : "classic"));
}

export function setTogglesDisabled(b) {
  for (const t of toggles) t.disabled = b;
}
