import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Model, DEFAULT_CONFIG, STRATEGIES, validate } from "./model.js";
import { Site, labelSprite, CLASSIC_KIT } from "./scene.js";
import { World } from "./world.js";
import { AudioEngine } from "./audio.js";
import { Voice } from "./voice.js";
import { Bubbles } from "./bubbles.js";
import { Director } from "./director.js";
import { loadLines, linesData } from "./lines.js";
import { getEdition, setEdition, onEditionChange, bindToggle, setTogglesDisabled, EDITION_CFG } from "./edition.js";

const $ = (s) => document.querySelector(s);
const rub = (x) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(x)) + " ₽";
const num = (x, d = 1) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: d }).format(x);
const KIND_NAMES = { excavator: "Экскаватор", bulldozer: "Бульдозер", crane: "Автокран", truck: "Самосвал" };
const SPEEDS = [{ h: 0.15, label: "×½" }, { h: 0.33, label: "×1" }, { h: 0.8, label: "×2" }, { h: 2.0, label: "×6" }];
const STORE_KEY = "slesar-ar-config-v1";
const SOUND_KEY = "slesar-ar-sound-v1";
const DEBUG = new URLSearchParams(location.search).has("debug");

const layout = await fetch("js/layout.json").then((r) => r.json());
const markerTex = new THREE.TextureLoader().load("assets/marker.png");
markerTex.colorSpace = THREE.SRGBColorSpace;
markerTex.anisotropy = 8;

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------
const state = {
  cfg: loadConfig(),
  discipline: "fifo",
  mode: "team",            // team | solo | both
  view: null,              // ar | 3d
  speed: 1,
  paused: false,
  between: 0,              // пауза между сменами, с
  worlds: [],
  root: new THREE.Group(), // содержимое площадки во внутренних координатах (y вверх)
  edition: getEdition(),   // classic | adult («Для опытных») — только оформление и звук
  kit: CLASSIC_KIT,        // набор моделей
  editionToken: 0,
  scene: null, renderer: null, camera: null, ground: null, lightRig: null,
};

// звук, голоса, субтитры: объекты создаются сразу, контекст — по первому нажатию
const audio = new AudioEngine();
const voice = new Voice(audio);
const bubbles = new Bubbles($("#bubbles"));
let director = null;
const sound = loadSound();
function loadSound() {
  const def = { muted: false, volume: 0.8, voices: true, subs: true, amb: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SOUND_KEY) || "{}") }; } catch (e) { return def; }
}
function saveSound() { try { localStorage.setItem(SOUND_KEY, JSON.stringify(sound)); } catch (e) { /* не критично */ } }
function applySound() {
  audio.setVolume(sound.volume);
  audio.setMuted(sound.muted);
  audio.setAmbOn(sound.amb);
  voice.setEnabled(sound.voices && !sound.muted);
  bubbles.setEnabled(sound.subs);
}
applySound();
let model = new Model(state.cfg);

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const c = JSON.parse(raw); validate(c); return c; }
  } catch (e) { /* нет хранилища или битые данные — берём данные задания */ }
  return structuredClone(DEFAULT_CONFIG);
}
function saveConfig() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.cfg)); } catch (e) { /* не критично */ }
}
const stratKey = (m) => (m === "solo" ? "solo6" : "team") + (state.discipline === "fifo" ? "_fifo" : "_prio");

// ---------------------------------------------------------------------------
// Построение миров
// ---------------------------------------------------------------------------
// подпись мира в «Двух мирах» (нужна и при пересборке площадки после смены версии)
function addWorldLabel(site, d) {
  const lbl = labelSprite(d.label, d.color);
  lbl.scale.multiplyScalar(2.2);
  lbl.position.set(0, 0.2, -layout.aspect / 2);
  site.group.add(lbl);
  site.own.push(lbl.material.map, lbl.material);
}
const siteOpts = (o) => ({ ...o, kit: state.kit, detail: state.mode === "both" ? "low" : "high" });

function buildWorlds() {
  for (const w of state.worlds) w.site.dispose();
  state.root.clear();
  state.worlds = [];
  const seed = (state.cfg.seed || 2026) + Math.floor(Math.random() * 1e6);
  const withBase = state.view === "3d" || state.mode === "both";

  if (state.mode === "both") {
    const defs = [
      { key: stratKey("team"), workers: ["6", "3"], x: -0.255, label: "С 3-м разрядом", color: "#1fa65a" },
      { key: stratKey("solo"), workers: ["6"], x: 0.255, label: "Без 3-го разряда", color: "#ff3b30" },
    ];
    for (const d of defs) {
      const opts = { withBase: true, baseTexture: markerTex, workers: d.workers };
      const site = new Site(model, layout, siteOpts(opts));
      site.group.scale.setScalar(0.48);
      site.group.position.set(d.x, 0.004, 0);
      addWorldLabel(site, d);
      state.root.add(site.group);
      const w = new World(model, d.key, site, seed);       // общие случайные числа
      Object.assign(w, { def: d, opts });
      state.worlds.push(w);
    }
  } else {
    const opts = { withBase, baseTexture: markerTex, workers: state.mode === "solo" ? ["6"] : ["6", "3"] };
    const site = new Site(model, layout, siteOpts(opts));
    state.root.add(site.group);
    const w = new World(model, stratKey(state.mode), site, seed);
    w.opts = opts;
    state.worlds.push(w);
  }
  director?.attach(state.worlds, state.mode);
  $("#voice-focus").classList.toggle("hidden", state.mode !== "both");
  renderFocus();
  renderHud(true);
}

// смена версии на лету: новые модели, смена (часы, деньги, поломки, слесари) продолжается
function rebuildSites() {
  for (const w of state.worlds) {
    const old = w.site;
    const ns = new Site(model, layout, siteOpts(w.opts));
    ns.adoptStateFrom(old);
    ns.group.scale.copy(old.group.scale);
    ns.group.position.copy(old.group.position);
    if (w.def) addWorldLabel(ns, w.def);
    state.root.add(ns.group);
    old.dispose();
    w.site = ns;
  }
}

function setMode(mode) {
  const prev = state.mode;
  state.mode = mode;
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  if (prev !== "both" && mode !== "both" && state.worlds.length === 1) {
    // на той же площадке: 3-й уходит или возвращается, начинается новая смена
    state.worlds[0].setStrategy(stratKey(mode));
    toast(mode === "solo" ? "Слесарь 3-го разряда <b>уволен</b>.<br>Новая смена: чинит только 6-й разряд" : "Слесарь 3-го разряда <b>вернулся</b>.<br>Новая смена: бригада 6+3");
    renderHud(true);
  } else {
    buildWorlds();
    state.refit && state.refit();
    if (mode === "both") toast("<b>Два мира</b>: одинаковые поломки,<br>разные бригады");
  }
}

// ---------------------------------------------------------------------------
// Сцена: 3D и AR
// ---------------------------------------------------------------------------
// свет по версии: обычная — прежний (без окружения и тональной компрессии),
// «Для опытных» — свет, окружение PMREM и ACES из набора моделей
function addLights(scene, renderer) {
  if (state.lightRig) state.lightRig.removeFromParent();
  let rig;
  if (state.kit.env) rig = state.kit.env.setupLights(scene, renderer);
  else {
    rig = new THREE.Group();
    rig.add(new THREE.HemisphereLight(0xffffff, 0xb59c78, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(0.6, 1.2, 0.8);
    rig.add(sun);
    scene.environment = null;
    renderer.toneMapping = THREE.NoToneMapping;
  }
  scene.add(rig);
  state.lightRig = rig;
}
function skyColor() {
  return state.kit.env?.sky || getComputedStyle(document.body).getPropertyValue("--sky").trim() || "#bfe6ff";
}
function applyBackdrop() {
  if (state.view !== "3d" || !state.scene) return;
  state.scene.background = new THREE.Color(skyColor());
  state.ground.material.color.set(state.kit.env?.ground || "#9fd27f");
}

let tick = () => {};
let stopView = () => {};

async function start3D() {
  state.view = "3d";
  const stage = $("#stage");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(skyColor());
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 20);
  // камера подбирается так, чтобы площадка целиком влезла в экран; в портрете схема повёрнута
  const fit = () => {
    const portrait = innerHeight > innerWidth * 1.1;
    state.root.rotation.y = portrait ? Math.PI / 2 : 0;
    const both = state.mode === "both";
    let w = both ? 1.02 : 1, h = both ? 0.36 : layout.aspect;
    if (portrait) [w, h] = [h, w];
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    const tilt = THREE.MathUtils.degToRad(50);
    const d = Math.max(w / 2 / Math.tan(hf), (h * Math.sin(tilt) * 0.5 + 0.08) / Math.tan(vf) + h * Math.cos(tilt) * 0.5) * 1.12;
    camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt));
    controls.target.set(0, 0, 0.02);
  };
  state.refit = fit;
  Object.assign(state, { scene, renderer, camera });
  addLights(scene, renderer);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: state.kit.env?.ground || "#9fd27f", roughness: 1 }));
  state.ground = ground;
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.013;
  scene.add(ground);
  scene.add(state.root);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 0.25;
  controls.maxDistance = 3;
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    fit();
  };
  addEventListener("resize", onResize);
  director.setView({ camera, canvas: renderer.domElement, isVisible: () => true });
  buildWorlds();
  fit();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    tick(Math.min(clock.getDelta(), 0.1));
    controls.update();
    renderer.render(scene, camera);
  });
  stopView = () => { renderer.setAnimationLoop(null); renderer.dispose(); removeEventListener("resize", onResize); };
}

async function startAR() {
  state.view = "ar";
  const { MindARThree } = await import("https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js");
  const mindar = new MindARThree({
    container: $("#stage"),
    imageTargetSrc: "assets/marker.mind",
    uiLoading: "no", uiScanning: "no", uiError: "no",
    filterMinCF: 0.0001, filterBeta: 0.001,
  });
  const { renderer, scene, camera } = mindar;
  Object.assign(state, { scene, renderer, camera });
  addLights(scene, renderer);
  const anchor = mindar.addAnchor(0);
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;            // внутренние координаты (y вверх) → плоскость метки
  holder.add(state.root);
  anchor.group.add(holder);
  anchor.onTargetFound = () => { $("#scan").classList.add("hidden"); director.setTracking(true); };
  anchor.onTargetLost = () => { $("#scan").classList.remove("hidden"); director.setTracking(false); };
  director.setView({ camera, canvas: renderer.domElement, isVisible: () => anchor.group.visible });
  buildWorlds();
  $("#scan").classList.remove("hidden");
  await mindar.start();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    tick(Math.min(clock.getDelta(), 0.1));
    renderer.render(scene, camera);
  });
  stopView = () => { renderer.setAnimationLoop(null); mindar.stop(); };
}

// ---------------------------------------------------------------------------
// Игровой цикл
// ---------------------------------------------------------------------------
let hudTimer = 0;
tick = (dt) => {
  if (!state.paused) {
    if (state.between > 0) {
      state.between -= dt;
      if (state.between <= 0) state.worlds.forEach((w) => w.startDay());
    } else {
      const hours = dt * SPEEDS[state.speed].h;
      state.worlds.forEach((w) => w.advance(hours));
      if (state.worlds.length && state.worlds.every((w) => w.finished)) endOfDay();
    }
  }
  for (const w of state.worlds) {
    w.site.walkScale = Math.max(1, SPEEDS[state.speed].h / 0.33);
    w.site.update(state.paused ? 0 : dt);
  }
  director?.update(dt, { paused: state.paused, hoursPerSec: SPEEDS[state.speed].h });
  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.12; renderHud(); }
  if (DEBUG) debugOverlay(dt);
};

// ?debug: вызовы отрисовки, треугольники, FPS, состояние звука
let dbgT = 0, dbgN = 0;
function debugOverlay(dt) {
  dbgT += dt; dbgN++;
  if (dbgT < 0.5) return;
  let el = $("#debug");
  if (!el) { el = document.createElement("pre"); el.id = "debug"; document.body.appendChild(el); }
  const r = state.renderer?.info.render;
  el.textContent = `calls ${r?.calls} · tris ${((r?.triangles || 0) / 1000).toFixed(0)}k · fps ${(dbgN / dbgT).toFixed(0)}\naudio ${audio.ctx?.state || "—"} · ${audio.set} · bank ${audio.memoryMB.toFixed(1)} МБ\nvoice ${voice.manifest ? "файлы" : "—"} · web ${voice.web.any?.name || "—"}`;
  dbgT = 0; dbgN = 0;
}

function endOfDay() {
  state.between = 3;
  const ws = state.worlds;
  if (ws.length === 2) {
    const [a, b] = ws.map((w) => w.history.at(-1).result);
    toast(`Смена ${ws[0].day} окончена<br>С 3-м: <b>${rub(a)}</b> · без: <b>${rub(b)}</b><br>Разница за смену: <b>${rub(a - b)}</b>`, 2800);
  } else {
    const s = ws[0].history.at(-1);
    toast(`Смена ${ws[0].day} окончена<br>Итог: <b>${rub(s.result)}</b><br>Простой съел: <b>${rub(s.loss)}</b>`, 2800);
  }
}

// ---------------------------------------------------------------------------
// Табло
// ---------------------------------------------------------------------------
function renderHud() {
  const ws = state.worlds;
  if (!ws.length) return;
  const w0 = ws[0];
  const t = 8 + w0.t;
  const hh = Math.floor(t) % 24, mm = Math.floor((t % 1) * 60);
  $("#hud-day").textContent = `Смена ${w0.day}`;
  $("#hud-time").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const box = $("#hud-money");
  if (ws.length === 1) {
    const m = w0.money, avg = w0.averages();
    box.innerHTML = `
      <div class="chip plus"><small>Доход</small><b>${rub(m.income)}</b></div>
      <div class="chip minus"><small>Простой</small><b>−${rub(m.loss)}</b></div>
      <div class="chip minus"><small>Слесари</small><b>−${rub(m.staff)}</b></div>
      <div class="chip total"><small>Итог смены</small><b>${rub(m.income - m.loss - m.staff)}</b></div>
      <div class="chip"><small>Ждут ремонта</small><b>${w0.queueLen} маш.</b></div>
      ${avg ? `<div class="chip"><small>Среднее за ${avg.days} см.</small><b>${rub(avg.result)}</b></div>` : ""}`;
  } else {
    const [a, b] = ws.map((w) => w.money);
    const res = (m) => m.income - m.loss - m.staff;
    const cls = (x, y) => (x >= y ? "win" : "lose");
    const [ha, hb] = ws.map((w) => w.averages());
    box.innerHTML = `<div class="cmp"><table>
      <tr><th></th><th>6+3</th><th>только 6</th></tr>
      <tr><td>Доход</td><td>${rub(a.income)}</td><td>${rub(b.income)}</td></tr>
      <tr><td>Простой</td><td>−${rub(a.loss)}</td><td>−${rub(b.loss)}</td></tr>
      <tr><td>Слесари</td><td>−${rub(a.staff)}</td><td>−${rub(b.staff)}</td></tr>
      <tr><td>Ждут ремонта</td><td>${ws[0].queueLen}</td><td>${ws[1].queueLen}</td></tr>
      <tr class="res"><td>Итог</td><td class="${cls(res(a), res(b))}">${rub(res(a))}</td><td class="${cls(res(b), res(a))}">${rub(res(b))}</td></tr>
      ${ha ? `<tr><td>Ср. за ${ha.days} см.</td><td>${rub(ha.result)}</td><td>${rub(hb.result)}</td></tr>` : ""}
    </table></div>`;
  }
}

// ---------------------------------------------------------------------------
// Панель исходных данных
// ---------------------------------------------------------------------------
const GENERAL = [
  ["wage_6", "Ставка 6-го разряда, ₽/ч"], ["wage_3", "Ставка 3-го разряда, ₽/ч"],
  ["overhead", "Накладные на бригаду, ₽/ч"], ["day_hours", "Рабочий день, ч"],
  ["work_days_per_year", "Рабочих дней в году"], ["sim_days", "Дней для «Вердикта»"],
];
let draft = null;

function openData() {
  draft = structuredClone(state.cfg);
  $("#discipline").value = state.discipline;
  renderDataForm();
  $("#data-error").textContent = "";
  $("#panel-data").classList.remove("hidden");
}
function renderDataForm() {
  const tb = $("#machines-table tbody");
  tb.innerHTML = "";
  draft.machines.forEach((m, i) => {
    const tr = document.createElement("tr");
    const opt = Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}" ${m.kind === k ? "selected" : ""}>${n}</option>`).join("");
    const val = (v) => (v == null ? "" : v);
    tr.innerHTML = `
      <td data-label="Название"><input data-f="name" value="${val(m.name).replace(/"/g, "&quot;")}"></td>
      <td data-label="Вид на площадке"><select data-f="kind">${opt}</select></td>
      <td data-label="Количество, шт."><input data-f="count" type="number" inputmode="numeric" min="0" step="1" value="${val(m.count)}"></td>
      <td data-label="Наработка, ч"><input data-f="mtbf" type="number" inputmode="decimal" min="0" step="0.1" value="${val(m.mtbf)}"></td>
      <td data-label="Доход, ₽/ч"><input data-f="income" type="number" inputmode="decimal" min="0" step="10" value="${val(m.income)}"></td>
      <td data-label="Ремонт 3-м, ч"><input data-f="repair_3" type="number" inputmode="decimal" min="0" step="0.05" value="${val(m.repair_3)}" placeholder="не чинит"></td>
      <td data-label="Ремонт 6-м, ч"><input data-f="repair_6" type="number" inputmode="decimal" min="0" step="0.05" value="${val(m.repair_6)}"></td>
      <td data-label="Ремонт вдвоём, ч"><input data-f="repair_both" type="number" inputmode="decimal" min="0" step="0.05" value="${val(m.repair_both)}"></td>
      <td><button class="del" title="Удалить">✕</button></td>`;
    tr.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("input", () => {
      const f = el.dataset.f;
      if (f === "name" || f === "kind") m[f] = el.value;
      else m[f] = el.value === "" ? null : Number(el.value);
    }));
    tr.querySelector(".del").onclick = () => { draft.machines.splice(i, 1); renderDataForm(); };
    tb.appendChild(tr);
  });
  $("#general-form").innerHTML = GENERAL.map(([k, l]) => `<label>${l}<input data-g="${k}" type="number" inputmode="decimal" min="0" value="${draft[k]}"></label>`).join("");
  document.querySelectorAll("[data-g]").forEach((el) => el.addEventListener("input", () => (draft[el.dataset.g] = Number(el.value))));
}
$("#btn-add-type").onclick = () => {
  draft.machines.push({ name: "Новая машина", kind: "truck", count: 2, mtbf: 6, income: 500, repair_3: null, repair_6: 2, repair_both: 1 });
  renderDataForm();
};
$("#btn-reset").onclick = () => { draft = structuredClone(DEFAULT_CONFIG); $("#discipline").value = "fifo"; renderDataForm(); };
$("#btn-apply").onclick = () => {
  try {
    validate(draft);
    const total = draft.machines.reduce((a, m) => a + m.count, 0);
    if (total > 80) throw new Error("для наглядности на площадке — не больше 80 машин");
    state.cfg = draft;
    state.discipline = $("#discipline").value;
    model = new Model(state.cfg);
    saveConfig();
    $("#panel-data").classList.add("hidden");
    lastVerdict = null;
    buildWorlds();
    toast("Данные применены — <b>новая смена</b>");
  } catch (e) {
    $("#data-error").textContent = "⚠ " + e.message;
  }
};

// ---------------------------------------------------------------------------
// Вердикт: полный расчёт (Монте-Карло + уравнения Колмогорова)
// ---------------------------------------------------------------------------
let lastVerdict = null;
async function openVerdict() {
  $("#panel-verdict").classList.remove("hidden");
  const body = $("#verdict-body");
  if (lastVerdict) return;
  const wasPaused = state.paused;
  state.paused = true;
  director?.setPaused(true);
  body.innerHTML = `<p class="hint">Моделирую ${num(state.cfg.sim_days, 0)} рабочих дней для каждой из ${STRATEGIES.length} стратегий и решаю уравнения Колмогорова…</p><div class="progress"><i id="vp"></i></div><p class="hint" id="vp-text"></p>`;
  const res = await model.runAll(state.cfg.sim_days, state.cfg.seed || 2026, (i, n, s) => {
    $("#vp").style.width = `${(100 * i) / n}%`;
    if (s) $("#vp-text").textContent = s.title;
  });
  state.paused = wasPaused;
  director?.setPaused(state.paused);
  lastVerdict = res;
  body.innerHTML = verdictHTML(res);
}

function verdictHTML(res) {
  const R = res.results, v = res.main;
  const maxBar = Math.max(v.saved, v.extraLoss, 1);
  const best = Object.values(R).reduce((a, r) => (r.econ.result > a.econ.result ? r : a));
  const rows = STRATEGIES.map((s) => {
    const r = R[s.key];
    const idle = (r.exact ? r.exact.idle : r.sim.idle).reduce((a, b) => a + b, 0);
    const method = r.exact ? `точно (Колмогоров); МК ${rub(r.sim.lossMean)} ± ${num(r.sim.lossCI, 0)}` : `Монте-Карло ± ${num(r.sim.lossCI, 0)} ₽`;
    return `<tr class="${r === best ? "best" : ""}"><td>${s.title}<span class="method">${method}</span></td>
      <td data-label="Простой, маш·ч/день">${num(idle)}</td><td data-label="Убыток от простоя">${rub(r.econ.lost)}</td>
      <td data-label="Слесари + накладные">${rub(r.econ.staff)}</td><td data-label="Итог за день"><b>${rub(r.econ.result)}</b></td></tr>`;
  }).join("");
  return `
    <div class="verdict-hero ${v.fire ? "fire" : ""}">
      <small>Бригада 6+3 против одного 6-го разряда (очередь FIFO)</small>
      <h3>${v.fire ? "Увольнение целесообразно" : "Увольнять нецелесообразно"}</h3>
      <p>${v.fire ? "Без 3-го разряда" : "С 3-м разрядом"} предприятие получает больше на <b>${rub(Math.abs(v.delta))}</b> в день — это ≈ <b>${num(Math.abs(v.deltaYear) / 1e6, 2)} млн ₽</b> в год.</p>
    </div>
    <div class="scale-row">
      <div class="pan"><small>Экономия на зарплате 3-го разряда</small><b style="color:var(--green)">+${rub(v.saved)}/день</b>
        <div class="bar"><i style="width:${(100 * v.saved) / maxBar}%;background:var(--green)"></i></div></div>
      <div class="pan"><small>Рост убытков от простоя машин</small><b style="color:var(--red)">−${rub(v.extraLoss)}/день</b>
        <div class="bar"><i style="width:${(100 * v.extraLoss) / maxBar}%;background:var(--red)"></i></div></div>
    </div>
    <div class="table-wrap"><table class="res-table">
      <thead><tr><th>Стратегия</th><th>Простой, маш·ч/день</th><th>Убыток от простоя</th><th>Слесари + накладные</th><th>Итог за день</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="chart">${histogram(R.team_fifo.sim.losses, R.solo6_fifo.sim.losses)}
      <div class="legend"><span><i style="background:#1fa65a"></i>бригада 6+3</span><span><i style="background:#ff3b30"></i>только 6-й разряд</span><span>— распределение убытка от простоя по дням</span></div></div>
    <p class="notes">
      <b>Модель:</b> замкнутая СМО, ${model.COUNT.reduce((a, b) => a + b, 0)} машин, наработка и ремонт — экспоненциальные, смена ${model.DAY} ч, утром все машины исправны.
      <b>Методы:</b> имитация ${num(state.cfg.sim_days, 0)} дней (Монте-Карло) и точное решение уравнений Колмогорова для приоритетных дисциплин${res.exactOk ? "" : " (пропущено: слишком много состояний)"}.
      <b>Итог</b> = доход от работы − убыток от простоя (= доходу) − зарплата − накладные.
      При трактовке «простой = только упущенный доход» разница составит ${rub(v.deltaAlt)} в день — вывод тот же.
      Сначала чинить самые «дорогие» машины (правило cμ) — бригада выгоднее на ${rub(res.prio.delta)} в день.
    </p>`;
}

function histogram(a, b) {
  const all = [...a, ...b];
  const lo = Math.min(...all), hi = Math.max(...all);
  const bins = 36, w = (hi - lo) / bins || 1;
  const count = (arr) => { const c = new Array(bins).fill(0); for (const x of arr) c[Math.min(bins - 1, Math.floor((x - lo) / w))]++; return c.map((k) => k / arr.length); };
  const ca = count(a), cb = count(b);
  const max = Math.max(...ca, ...cb);
  const W = 600, H = 170, pad = 22;
  const bar = (c, color) => c.map((k, i) => {
    const h = ((H - pad) * k) / max;
    return `<rect x="${(i * W) / bins + 1}" y="${H - pad - h}" width="${W / bins - 2}" height="${h}" rx="2" fill="${color}" fill-opacity="0.6"/>`;
  }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${f * W}" y="${H - 4}" font-size="11" fill="currentColor" opacity="0.6" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${num((lo + f * (hi - lo)) / 1000, 0)} тыс. ₽</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Гистограмма убытков">${bar(ca, "#1fa65a")}${bar(cb, "#ff3b30")}${ticks}</svg>`;
}

// ---------------------------------------------------------------------------
// Кнопки и прочее
// ---------------------------------------------------------------------------
let toastTimer;
function toast(html, ms = 2200) {
  const t = $("#toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// загрузка набора моделей «Для опытных» (кэш модуля; обычная версия его не грузит)
async function loadKit(ed) {
  if (ed !== "adult") return CLASSIC_KIT;
  return (await import("./models-real.js")).kit;
}

async function enter(view) {
  state.edition = getEdition();
  try { state.kit = await loadKit(state.edition); }
  catch (e) { console.error(e); state.edition = "classic"; state.kit = CLASSIC_KIT; setEdition("classic"); toast("Не удалось загрузить режим «Для опытных»", 3000); }
  director = new Director({ audio, voice, bubbles, edition: state.edition });
  audio.setSet(EDITION_CFG[state.edition].sfxSet);
  voice.init(state.edition).then(() => { if (!voice.available) noVoiceToast(); });
  $("#start").classList.add("hidden");
  $("#hud").classList.remove("hidden");
  $("#bar").classList.remove("hidden");
  try {
    if (view === "ar") await startAR();
    else await start3D();
  } catch (e) {
    console.error(e);
    if (view !== "ar") { toast("Не удалось запустить 3D 😕<br>" + e.message, 6000); return; }
    stopView();
    $("#stage").innerHTML = "";
    $("#scan").classList.add("hidden");
    toast("Камера недоступна 😕<br>Включаю <b>3D-режим</b>", 3000);
    await start3D();
  }
}

// разблокировка звука и речи — СИНХРОННО в обработчике нажатия, до любого await (iOS)
function launch(view) {
  audio.unlockSync();
  voice.unlockSync();
  enter(view);
}
$("#btn-ar").onclick = () => launch("ar");
$("#btn-3d").onclick = () => launch("3d");
$("#btn-home").onclick = () => location.reload();
$("#btn-pause").onclick = (e) => {
  state.paused = !state.paused;
  e.currentTarget.textContent = state.paused ? "▶" : "⏸";
  director?.setPaused(state.paused);
};
$("#btn-speed").onclick = (e) => { state.speed = (state.speed + 1) % SPEEDS.length; e.currentTarget.textContent = SPEEDS[state.speed].label; };
document.querySelectorAll("#mode button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$("#btn-data").onclick = openData;
$("#btn-verdict").onclick = openVerdict;
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest(".panel").classList.add("hidden")));
document.querySelectorAll(".panel").forEach((p) => p.addEventListener("click", (e) => { if (e.target === p) p.classList.add("hidden"); }));

// ---------------------------------------------------------------------------
// Версия: тумблеры «Для опытных» на старте и в попапе, переключение на лету
// ---------------------------------------------------------------------------
bindToggle($("#tgl-pro-start"));
bindToggle($("#tgl-pro-game"));
onEditionChange((ed) => applyEdition(ed));

async function applyEdition(ed) {
  if (!state.view || !director || !state.scene) return;   // стартовый экран: только тема и сохранение
  const tok = ++state.editionToken;
  setTogglesDisabled(true);
  toast("Переключаю…", 1200);
  let kit;
  try { kit = await loadKit(ed); }
  catch (e) {
    console.error(e);
    setTogglesDisabled(false);
    toast("Не удалось загрузить режим «Для опытных»", 3000);
    setEdition("classic");
    return;
  }
  if (tok !== state.editionToken) return;                  // пока грузилось, переключили ещё раз
  state.edition = ed;
  state.kit = kit;
  try {
    addLights(state.scene, state.renderer);
    applyBackdrop();
    rebuildSites();
  } catch (e) {
    console.error(e);
    buildWorlds();
    toast("Новая смена", 2000);
  }
  director.setEdition(ed);
  director.attach(state.worlds, state.mode);
  audio.setSet(EDITION_CFG[ed].sfxSet);
  voice.setSet(ed);
  setTogglesDisabled(false);
  toast(ed === "adult" ? "Режим «<b>Для опытных</b>» включён" : "<b>Обычная</b> версия", 1800);
  renderHud();
}

// ---------------------------------------------------------------------------
// Попап «Звук и версия»
// ---------------------------------------------------------------------------
function renderSound() {
  $("#snd-mute").textContent = sound.muted ? "🔇 Звук выключен" : "🔊 Звук включён";
  $("#btn-sound").textContent = sound.muted ? "🔇" : "🔊";
  $("#vol").value = sound.volume;
  $("#snd-voices").checked = sound.voices;
  $("#snd-subs").checked = sound.subs;
  $("#snd-amb").checked = sound.amb;
}
renderSound();
$("#btn-sound").onclick = () => {
  audio.unlockSync();
  $("#sound-pop").classList.toggle("hidden");
};
document.addEventListener("pointerdown", (e) => {
  const pop = $("#sound-pop");
  if (!pop.classList.contains("hidden") && !pop.contains(e.target) && !$("#btn-sound").contains(e.target)) pop.classList.add("hidden");
});
const soundChanged = () => { saveSound(); applySound(); renderSound(); };
$("#snd-mute").onclick = () => { sound.muted = !sound.muted; if (!sound.muted) audio.unlockSync(); soundChanged(); };
$("#vol").oninput = (e) => { sound.volume = Number(e.target.value); soundChanged(); };
$("#snd-voices").onchange = (e) => { sound.voices = e.target.checked; soundChanged(); };
$("#snd-subs").onchange = (e) => { sound.subs = e.target.checked; soundChanged(); };
$("#snd-amb").onchange = (e) => { sound.amb = e.target.checked; soundChanged(); };

// «Проверить голоса»: по одной реплике за каждую роль текущей версии
$("#snd-test").onclick = async () => {
  audio.unlockSync();
  voice.unlockSync();
  await voice.init(getEdition());
  await loadLines();
  const data = linesData(), set = EDITION_CFG[getEdition()].linesSet;
  voice.cancelAll();
  for (const who of ["foreman", "w6", "w3", "op.excavator", "op.bulldozer", "op.crane", "op.truck"]) {
    const line = Object.values(data[set]).flat().find((l) => l.who === who);
    if (!line) continue;
    let b = null;
    const st = await voice.say({
      line, priority: 95, ttl: 30,
      onStart: () => { b = bubbles.show({ who, label: data.roles[who].label, text: line.t, anchor: null }); },
      onEnd: () => bubbles.hide(b, 0.4),
    });
    if (st === "cancelled") break;
  }
};

// «Два мира»: чей голос слышен
function renderFocus() {
  if (!director) return;
  $("#voice-focus").textContent = director.focus === 1 ? "🔊 Озвучка: без 3-го ⇄" : "🔊 Озвучка: с 3-м ⇄";
}
$("#voice-focus").onclick = () => { director?.setFocus(director.focus === 1 ? 0 : 1); renderFocus(); };

let noVoiceShown = false;
function noVoiceToast() {
  if (noVoiceShown || !sound.voices) return;
  noVoiceShown = true;
  toast("Нет русского голоса — показываю субтитры.<br>iOS: Настройки → Универсальный доступ → Устный контент → Голоса → Русский<br>Android: Настройки → Синтез речи → Google, русский", 6000);
}
voice.onNoVoice = noVoiceToast;
audio.onLoadStart = () => toast("Загружаю звуки…", 1500);

// вкладка скрыта — тишина
document.addEventListener("visibilitychange", () => {
  audio.setHidden(document.hidden);
  if (document.hidden) { voice.cancelAll(); bubbles.clear(); }
});

// для отладки в консоли
window.__app = { state, audio, voice, bubbles, get director() { return director; }, get renderer() { return state.renderer; }, get model() { return model; } };

