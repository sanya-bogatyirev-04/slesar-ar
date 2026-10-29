// Игрушечная 3D-стройплощадка. Внутренние координаты: x — вправо, y — вверх (высота),
// z — к нижнему краю схемы. 1 единица = ширина метки. Точка схемы (mx, my) → (mx, 0, -my).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const P = (mx, my, y = 0) => new THREE.Vector3(mx, y, -my);

// ---------------------------------------------------------------------------
// Материалы и геометрии (общие для всех экземпляров)
// ---------------------------------------------------------------------------
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: false, ...opts }));
  return matCache.get(key);
}
const geoCache = new Map();
function rbox(w, h, d, r = 0.2) {
  const key = [w, h, d, r].join();
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * r));
  return geoCache.get(key);
}
function cyl(rt, rb, h, seg = 16) {
  const key = ["c", rt, rb, h, seg].join();
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(key);
}
function sph(r, seg = 16) {
  const key = ["s", r, seg].join();
  if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)));
  return geoCache.get(key);
}
// прочие геометрии — тоже из кэша, чтобы пересборка площадки (смена версии) не копила их в памяти
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const C = {
  track: "#3b3f4a", glass: "#9fd8ff", dark: "#2a2d36", wheel: "#2f323b", hub: "#d9dde5",
  dirt: "#8b5a2b", white: "#f4f4f0", steel: "#8a93a6",
};
const TINTS = {
  excavator: ["#ffc21a", "#ffd95a", "#f2a900"],
  bulldozer: ["#ff8a2a", "#ff6f3c", "#ffa95e"],
  crane: ["#e8473c", "#ff6b6b", "#c9302c"],
  truck: ["#2f8cff", "#24b47e", "#7a5cff"],
};

let shadowMat = null;          // один общий материал: площадки пересобираются при смене версии
function blobShadow(parent, rx, rz) {
  const key = "shadow";
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CircleGeometry(1, 24));
  shadowMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  const m = new THREE.Mesh(geoCache.get(key), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(rx, rz, 1);
  m.position.y = 0.0008;
  parent.add(m);
  return m;
}

function wheels(parent, xs, zHalf, r, y) {
  for (const x of xs) for (const z of [-zHalf, zHalf]) {
    const w = add(parent, cyl(r, r, r * 0.9, 14), mat(C.wheel), x, y, z);
    w.rotation.x = Math.PI / 2;
    const h = add(parent, cyl(r * 0.45, r * 0.45, r * 0.95, 10), mat(C.hub), x, y, z);
    h.rotation.x = Math.PI / 2;
  }
}

// ---------------------------------------------------------------------------
// Модели машин (смотрят вдоль +x)
// ---------------------------------------------------------------------------
function makeExcavator(color) {
  const g = new THREE.Group();
  for (const z of [-0.017, 0.017]) add(g, rbox(0.062, 0.013, 0.013, 0.45), mat(C.track), 0, 0.0065, z);
  const turret = new THREE.Group();
  turret.position.y = 0.016;
  g.add(turret);
  add(turret, rbox(0.044, 0.016, 0.036), mat(color), -0.004, 0.008, 0);
  add(turret, rbox(0.016, 0.012, 0.032), mat(C.dark), -0.024, 0.01, 0);           // противовес
  const cab = add(turret, rbox(0.017, 0.02, 0.016, 0.25), mat(color), 0.01, 0.025, -0.009);
  add(cab, rbox(0.012, 0.012, 0.0165, 0.2), mat(C.glass), 0.003, 0.002, 0);
  const boom = new THREE.Group();
  boom.position.set(0.016, 0.018, 0.007);
  turret.add(boom);
  const b1 = add(boom, rbox(0.05, 0.007, 0.007, 0.4), mat(color), 0.023, 0, 0);
  b1.rotation.z = 0;
  const stick = new THREE.Group();
  stick.position.set(0.046, 0, 0);
  boom.add(stick);
  add(stick, rbox(0.006, 0.036, 0.006, 0.4), mat(color), 0, -0.016, 0);
  const bucket = add(stick, rbox(0.014, 0.011, 0.013, 0.3), mat(C.dark), 0.004, -0.035, 0);
  add(bucket, rbox(0.01, 0.005, 0.011, 0.3), mat(C.dirt), 0, 0.006, 0);
  blobShadow(g, 0.04, 0.03);
  g.userData.parts = { turret, boom, stick };
  g.userData.top = 0.07;
  return g;
}

function makeBulldozer(color) {
  const g = new THREE.Group();
  for (const z of [-0.016, 0.016]) add(g, rbox(0.05, 0.013, 0.012, 0.45), mat(C.track), 0, 0.0065, z);
  add(g, rbox(0.04, 0.017, 0.03), mat(color), -0.002, 0.021, 0);
  const cab = add(g, rbox(0.018, 0.018, 0.022, 0.25), mat(color), -0.01, 0.038, 0);
  add(cab, rbox(0.0185, 0.01, 0.017, 0.2), mat(C.glass), 0, 0.002, 0);
  add(g, cyl(0.002, 0.002, 0.016), mat(C.dark), 0.008, 0.037, 0.008);              // выхлоп
  const blade = add(g, rbox(0.006, 0.02, 0.05, 0.3), mat(C.steel), 0.033, 0.012, 0);
  blade.rotation.z = -0.15;
  add(g, rbox(0.012, 0.006, 0.04, 0.3), mat(C.dirt), 0.041, 0.005, 0);
  blobShadow(g, 0.035, 0.03);
  g.userData.parts = { blade };
  g.userData.top = 0.06;
  return g;
}

function makeCrane(color) {
  const g = new THREE.Group();
  add(g, rbox(0.075, 0.01, 0.026, 0.3), mat(C.dark), 0, 0.012, 0);
  add(g, rbox(0.072, 0.008, 0.028, 0.3), mat(color), 0, 0.019, 0);
  const cab = add(g, rbox(0.017, 0.02, 0.024, 0.3), mat(color), 0.029, 0.031, 0);
  add(cab, rbox(0.012, 0.01, 0.0245, 0.2), mat(C.glass), 0.003, 0.003, 0);
  wheels(g, [-0.026, -0.012, 0.024], 0.014, 0.007, 0.007);
  const turret = new THREE.Group();
  turret.position.set(-0.014, 0.024, 0);
  g.add(turret);
  add(turret, rbox(0.022, 0.012, 0.022), mat(C.white), 0, 0.006, 0);
  const boom = new THREE.Group();
  boom.position.set(0.006, 0.012, 0);
  boom.rotation.z = 0.85;
  turret.add(boom);
  add(boom, rbox(0.11, 0.008, 0.008, 0.4), mat(color), 0.055, 0, 0);
  add(boom, rbox(0.07, 0.006, 0.006, 0.4), mat(C.white), 0.1, 0, 0);
  const hookAnchor = new THREE.Object3D();
  hookAnchor.position.set(0.133, 0, 0);
  boom.add(hookAnchor);
  const rope = add(g, cyl(0.0007, 0.0007, 1, 6), mat(C.dark), 0, 0, 0);
  const load = add(g, rbox(0.016, 0.01, 0.016, 0.2), mat("#c8a46a"), 0, 0, 0);
  blobShadow(g, 0.045, 0.022);
  g.userData.parts = { turret, boom, hookAnchor, rope, load };
  g.userData.top = 0.13;
  return g;
}

function makeTruck(color) {
  const g = new THREE.Group();
  add(g, rbox(0.062, 0.008, 0.022, 0.3), mat(C.dark), 0, 0.011, 0);
  const cab = add(g, rbox(0.017, 0.021, 0.024, 0.3), mat(color), 0.022, 0.024, 0);
  add(cab, rbox(0.012, 0.01, 0.0245, 0.2), mat(C.glass), 0.003, 0.004, 0);
  const bed = new THREE.Group();
  bed.position.set(-0.026, 0.016, 0);
  g.add(bed);
  add(bed, rbox(0.04, 0.016, 0.026, 0.2), mat(color), 0.019, 0.009, 0);
  const dirt = add(bed, sph(0.012, 10), mat(C.dirt), 0.019, 0.016, 0);
  dirt.scale.set(1.5, 0.6, 1);
  wheels(g, [-0.018, 0.022], 0.012, 0.0075, 0.0075);
  blobShadow(g, 0.04, 0.022);
  g.userData.parts = { bed };
  g.userData.top = 0.06;
  return g;
}

const MAKERS = { excavator: makeExcavator, bulldozer: makeBulldozer, crane: makeCrane, truck: makeTruck };

export function makeWorker(grade) {
  const g = new THREE.Group();
  const suit = grade === "6" ? "#2b6cff" : "#1fa65a";
  const helmet = grade === "6" ? "#ffffff" : "#ffd23f";
  const body = add(g, cached("capsule", () => new THREE.CapsuleGeometry(0.0062, 0.011, 4, 10)), mat(suit), 0, 0.016, 0);
  add(body, rbox(0.0128, 0.003, 0.0128, 0.3), mat("#ff9d2a"), 0, 0.001, 0);           // светоотражающая полоса
  add(g, sph(0.0058, 14), mat("#ffd2b0"), 0, 0.032, 0);
  const h = add(g, cached("helmet", () => new THREE.SphereGeometry(0.0064, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat(helmet), 0, 0.0335, 0);
  add(h, cyl(0.0078, 0.0078, 0.0012, 14), mat(helmet), 0, 0, 0);
  const wrench = add(g, rbox(0.0025, 0.012, 0.0025, 0.3), mat(C.steel), 0.008, 0.018, 0);
  blobShadow(g, 0.009, 0.009);
  g.userData.parts = { body, wrench };
  return g;
}

// Обычный (игрушечный) набор моделей. Режим «Для опытных» подставляет свой набор из models-real.js
// с тем же интерфейсом: машины, слесари, значки, цвет дыма, окружение (decor) и свет (env).
export const CLASSIC_KIT = {
  id: "classic",
  tints: TINTS,
  makeMachine: (kind, tint) => MAKERS[kind](tint),
  makeWorker: (g) => makeWorker(g),
  icons: () => icons(),
  badge: { 6: "#2b6cff", 3: "#1fa65a" },
  smokeColor: "#6b6f7a",
  decor: null,
  env: null,
};

// ---------------------------------------------------------------------------
// Значки-«пузыри» над машинами
// ---------------------------------------------------------------------------
function iconTexture(bg, symbol, fg = "#fff") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "rgba(0,0,0,0.25)";
  x.beginPath(); x.arc(66, 68, 54, 0, Math.PI * 2); x.fill();
  x.fillStyle = bg;
  x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fill();
  x.lineWidth = 8; x.strokeStyle = "#fff"; x.stroke();
  x.fillStyle = fg;
  x.font = "bold 72px Rubik, Arial, sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(symbol, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let ICONS = null;
function icons() {
  if (!ICONS) ICONS = {
    wait: new THREE.SpriteMaterial({ map: iconTexture("#ff3b30", "!"), depthTest: false }),
    fix: new THREE.SpriteMaterial({ map: iconTexture("#ffcc00", "⚒", "#3a2a00"), depthTest: false }),
  };
  return ICONS;
}

export function labelSprite(text, bg = "#1f2433", fg = "#fff") {
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  x.font = "bold 44px Rubik, Arial, sans-serif";
  const w = Math.ceil(x.measureText(text).width) + 48;
  c.width = w; c.height = 72;
  x.font = "bold 44px Rubik, Arial, sans-serif";
  x.fillStyle = bg;
  x.beginPath(); x.roundRect(0, 0, w, 72, 36); x.fill();
  x.fillStyle = fg; x.textBaseline = "middle"; x.textAlign = "center";
  x.fillText(text, w / 2, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(0.05 * w / 72, 0.05, 1);
  s.renderOrder = 10;
  return s;
}

// ---------------------------------------------------------------------------
// Дым от сломанных машин
// ---------------------------------------------------------------------------
class Smoke {
  constructor(parent, n = 90, color = "#6b6f7a") {
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sph(1, 8), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, depthWrite: false, roughness: 1 }));
      m.visible = false;
      parent.add(m);
      this.pool.push({ m, life: 0, max: 1 });
    }
    this.i = 0;
  }
  emit(pos) {
    const p = this.pool[this.i++ % this.pool.length];
    p.m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.01, 0, (Math.random() - 0.5) * 0.01));
    p.life = 0; p.max = 1.2 + Math.random() * 0.6; p.m.visible = true;
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.m.visible = false; continue; }
      p.m.position.y += dt * 0.03;
      p.m.position.x += dt * 0.006;
      p.m.scale.setScalar(0.004 + k * 0.012);
      p.m.material.opacity = 0.75 * (1 - k);
    }
  }
  dispose() { for (const p of this.pool) p.m.material.dispose(); }
}

// ---------------------------------------------------------------------------
// Размещение машин по зонам схемы (работает при любом количестве)
// ---------------------------------------------------------------------------
function gridIn(rect, n) {
  const [x0, y0, x1, y1] = rect;                         // y0 — верх, y1 — низ (y вверх)
  const w = x1 - x0, h = y0 - y1;
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    out.push([x0 + (w * (c + 0.5)) / inRow, y0 - (h * (r + 0.5)) / rows]);
  }
  return out;
}

function placeAll(layout, kindsCount) {
  const z = layout.zones;
  const res = {};
  res.excavator = gridIn(z.pit_rect, kindsCount.excavator || 0);
  const nb = kindsCount.bulldozer || 0;
  const [px0, py0, px1, py1] = z.plan_rect;
  res.bulldozer = Array.from({ length: nb }, (_, i) => [(px0 + px1) / 2, py0 - ((py0 - py1) * (i + 0.5)) / Math.max(nb, 1)]);
  const nc = kindsCount.crane || 0;
  const [bcx, bcy] = z.building.center;
  res.crane = nc === 4 ? z.crane.map((p) => [...p]) :
    Array.from({ length: nc }, (_, i) => {
      const a = (2 * Math.PI * i) / Math.max(nc, 1) + Math.PI / 4;
      return [bcx + 0.15 * Math.cos(a), bcy + 0.09 * Math.sin(a)];
    });
  const nt = kindsCount.truck || 0;
  res.truck = Array.from({ length: nt }, (_, i) => (2 * Math.PI * i) / nt);
  return res;
}

// ---------------------------------------------------------------------------
// Площадка
// ---------------------------------------------------------------------------
const EXIT = () => P(0.56, -0.32);
const keyOf = (mc) => `${mc.type}:${mc.idx}`;

export class Site {
  // kit — набор моделей (CLASSIC_KIT или реалистичный из models-real.js); detail — "high" | "low" (для «Двух миров»)
  constructor(model, layout, { withBase = false, baseTexture = null, workers = ["6", "3"], kit = CLASSIC_KIT, detail = "high" } = {}) {
    this.model = model;
    this.layout = layout;
    this.kit = kit;
    this.detail = detail;
    this.group = new THREE.Group();
    this.time = 0;
    this.smoke = new Smoke(this.group, 90, kit.smokeColor);
    this.own = [];                 // собственные ресурсы площадки (освобождаются в dispose)
    this.on = null;                // излучатель событий для режиссёра: fire | hire | stay | gone
    this.stageExit = false;        // true — уволенный ждёт режиссёра (сценка), иначе уходит сразу
    const z = layout.zones;

    if (withBase) {
      const baseMat = new THREE.MeshStandardMaterial({ map: baseTexture, roughness: 0.9 });
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.012, layout.aspect),
        [mat("#d8d2c0"), mat("#d8d2c0"), baseMat, mat("#d8d2c0"), mat("#d8d2c0"), mat("#d8d2c0")]
      );
      base.position.y = -0.0061;
      this.group.add(base);
      this.own.push(base.geometry, baseMat);
    }

    if (kit.decor) kit.decor(this, layout, detail);     // «Для опытных»: своё окружение (заполняет building, floors, trailerPos)
    else this.classicDecor(z);

    this.buildMachines();
    this.workers = {};
    this.basePos = P(...z.base);
    this.setWorkers(workers, true);
  }

  classicDecor(z) {
    // корпус «Б» — растёт, пока работают краны
    const [bx, by] = z.building.center;
    const [bw, bd] = z.building.size;
    this.building = new THREE.Group();
    this.building.position.copy(P(bx, by));
    this.group.add(this.building);
    this.floors = [];
    for (let i = 0; i < 10; i++) {
      const f = add(this.building, rbox(bw * 0.98, 0.009, bd * 0.98, 0.1), mat(i % 2 ? "#cfd5df" : "#b8c0cd"), 0, 0.0045 + i * 0.0095, 0);
      f.visible = i === 0;
      this.floors.push(f);
    }

    // вагончик слесарей
    const tr = new THREE.Group();
    tr.position.copy(P(...z.trailer));
    add(tr, rbox(0.085, 0.04, 0.05, 0.12), mat("#3d7be0"), 0, 0.02, 0);
    add(tr, rbox(0.088, 0.006, 0.053, 0.3), mat(C.white), 0, 0.042, 0);
    for (const x of [-0.025, 0.012]) add(tr, rbox(0.016, 0.012, 0.002), mat(C.glass), x, 0.024, 0.026);
    add(tr, rbox(0.012, 0.026, 0.002), mat("#ffd23f"), 0.032, 0.015, 0.026);
    blobShadow(tr, 0.055, 0.035);
    this.group.add(tr);
    const sign = labelSprite("РЕМОНТ", "#3d7be0");
    sign.position.set(0, 0.07, 0);
    sign.scale.multiplyScalar(0.8);
    tr.add(sign);
    this.own.push(sign.material.map, sign.material);
    this.trailerPos = tr.position.clone().add(new THREE.Vector3(0.032, 0, 0.036));   // у двери
    this.trailerTop = tr.position.clone().add(new THREE.Vector3(0, 0.085, 0));       // откуда «говорит» прораб

    // деревья
    for (const [mx, my] of z.trees) {
      const t = new THREE.Group();
      t.position.copy(P(mx, my));
      add(t, cyl(0.002, 0.003, 0.014, 8), mat("#7a4e2d"), 0, 0.007, 0);
      add(t, cached("cone1", () => new THREE.ConeGeometry(0.011, 0.024, 9)), mat("#3fae5a"), 0, 0.024, 0);
      add(t, cached("cone2", () => new THREE.ConeGeometry(0.008, 0.018, 9)), mat("#55c46e"), 0, 0.034, 0);
      const s = 0.8 + ((mx * 97 + my * 31) % 1 + 1) % 1 * 0.6;
      t.scale.setScalar(s);
      this.group.add(t);
    }
  }

  buildMachines() {
    const m = this.model;
    const kit = this.kit;
    const kindsCount = {};
    m.KINDS.forEach((k, t) => (kindsCount[k] = (kindsCount[k] || 0) + m.COUNT[t]));
    const places = placeAll(this.layout, kindsCount);
    const used = {};
    this.machines = new Map();
    this.loop = this.layout.zones.truck_loop;
    m.KINDS.forEach((kind, t) => {
      const tint = kit.tints[kind][m.KINDS.slice(0, t).filter((k) => k === kind).length % 3];
      for (let i = 0; i < m.COUNT[t]; i++) {
        const k = (used[kind] = (used[kind] || 0) + 1) - 1;
        const obj = kit.makeMachine(kind, tint, this.detail);
        const mc = {
          type: t, idx: i, kind, obj, state: "work", smokeT: 0,
          phase: Math.random() * Math.PI * 2, speed: 0.8 + Math.random() * 0.4,
          icon: new THREE.Sprite(kit.icons().wait),
        };
        if (kind === "truck") {
          mc.angle = places.truck[k];
        } else {
          const [mx, my] = places[kind][k];
          mc.home = P(mx, my);
          obj.position.copy(mc.home);
          if (kind === "excavator") obj.rotation.y = Math.random() * Math.PI * 2;
          if (kind === "crane") {
            const [bcx, bcy] = this.layout.zones.building.center;
            obj.rotation.y = Math.atan2(bcy - my, bcx - mx);   // стрелой к корпусу
          }
          if (kind === "bulldozer") mc.span = (this.layout.zones.plan_rect[2] - this.layout.zones.plan_rect[0]) / 2 - 0.05;
        }
        mc.icon.scale.set(0.032, 0.032, 1);
        mc.icon.position.y = obj.userData.top + 0.022;
        mc.icon.visible = false;
        mc.icon.renderOrder = 20;
        obj.add(mc.icon);
        this.group.add(obj);
        this.machines.set(`${t}:${i}`, mc);
      }
    });
  }

  emit(name, data) { this.on?.(name, data); }

  makeWorkerAt(g, pos) {
    const obj = this.kit.makeWorker(g, this.detail);
    const badge = labelSprite(g === "6" ? "6 р." : "3 р.", this.kit.badge[g]);
    badge.scale.multiplyScalar(0.55);
    badge.position.y = obj.userData.badgeY ?? 0.05;
    obj.add(badge);
    obj.userData.badge = badge;
    obj.position.copy(pos);
    this.group.add(obj);
    return (this.workers[g] = { grade: g, obj, target: null, job: null, leaving: false, exitHold: false, staged: null, holdT: 0, atJob: false });
  }

  // кто есть на площадке; уволенный уходит за край схемы
  setWorkers(list, instant = false) {
    for (const g of ["6", "3"]) {
      const want = list.includes(g);
      let w = this.workers[g];
      if (want && !w) {
        const start = instant ? this.basePos.clone().add(new THREE.Vector3(g === "6" ? -0.012 : 0.012, 0, 0)) : P(0.52, -0.3);
        w = this.makeWorkerAt(g, start);
        if (!instant) this.emit("hire", w);
      } else if (want && w && w.leaving) {
        // передумали, пока уходил: остаётся (раньше доходил до края и исчезал)
        w.leaving = false; w.exitHold = false; w.target = null; w.staged = null;
        this.emit("stay", w);
      } else if (!want && w && !w.leaving) {
        w.leaving = true;
        w.job = null;
        if (this.stageExit) {                      // сценка: ждёт режиссёра, потом уходит
          w.exitHold = true; w.target = null; w.holdT = 0;
          this.emit("fire", w);
        } else w.target = EXIT();
      }
    }
  }

  // сценки: отвести слесаря в точку (он там стоит) и отпустить
  stageWorker(g, pos) { const w = this.workers[g]; if (w) w.staged = pos.clone(); }
  releaseWorker(g) {
    const w = this.workers[g];
    if (!w) return;
    w.staged = null;
    if (w.leaving) { w.target = EXIT(); w.exitHold = false; }
  }

  machinePos(mc) {
    return mc.obj.position;
  }

  resetDay() {
    for (const mc of this.machines.values()) this.setState(mc, "work");
    for (const w of Object.values(this.workers)) if (!w.leaving) w.job = null;
  }

  setState(mc, s) {
    mc.state = s;
    mc.icon.visible = s !== "work";
    mc.icon.material = s === "fix" ? this.kit.icons().fix : this.kit.icons().wait;
    mc.obj.rotation.z = s === "work" ? 0 : 0.04;
  }

  onBreak(type, idx) {
    const mc = this.machines.get(`${type}:${idx}`);
    if (mc) this.setState(mc, "wait");
  }
  onFix(type, idx) {
    const mc = this.machines.get(`${type}:${idx}`);
    if (mc) this.setState(mc, "work");
  }
  // jobs: [{type, idx, who:[...]}] — текущая расстановка из модели
  assign(jobs) {
    for (const mc of this.machines.values()) if (mc.state === "fix") this.setState(mc, "wait");
    for (const w of Object.values(this.workers)) {
      if (w.leaving) continue;
      const job = jobs.find((j) => j.who.includes(w.grade));
      w.job = job ? this.machines.get(`${job.type}:${job.idx}`) : null;
    }
    for (const j of jobs) {
      const mc = this.machines.get(`${j.type}:${j.idx}`);
      if (mc) this.setState(mc, "fix");
    }
  }

  setBuildingProgress(f) {
    const n = 1 + Math.floor(Math.min(f, 0.999) * this.floors.length);
    this.floors.forEach((fl, i) => (fl.visible = i < n));
  }

  // смена версии на лету: перенести состояние старой площадки (смена не прерывается)
  adoptStateFrom(old) {
    this.time = old.time;
    this.walkScale = old.walkScale;
    for (const [key, mc] of this.machines) {
      const o = old.machines.get(key);
      if (!o) continue;
      this.setState(mc, o.state);
      Object.assign(mc, { phase: o.phase, speed: o.speed, smokeT: o.smokeT });
      if (o.angle !== undefined) mc.angle = o.angle;
      mc.obj.position.copy(o.obj.position);
      mc.obj.rotation.y = o.obj.rotation.y;
    }
    this.floors.forEach((f, i) => (f.visible = !!old.floors[i]?.visible));
    for (const g of Object.keys(this.workers)) {
      if (old.workers[g]) continue;
      this.group.remove(this.workers[g].obj);
      this.disposeWorker(this.workers[g]);
      delete this.workers[g];
    }
    for (const [g, o] of Object.entries(old.workers)) {
      const w = this.workers[g] || this.makeWorkerAt(g, o.obj.position);
      w.obj.position.copy(o.obj.position);
      w.obj.rotation.y = o.obj.rotation.y;
      w.job = o.job ? this.machines.get(keyOf(o.job)) || null : null;
      w.leaving = o.leaving;
      w.exitHold = false; w.staged = null;
      w.target = o.leaving ? EXIT() : null;          // сценка обрывается — уволенный просто уходит
    }
  }

  disposeWorker(w) {
    const b = w.obj.userData.badge;
    if (b) { b.material.map.dispose(); b.material.dispose(); }
    w.obj.userData.dispose?.();
  }

  // освобождает только собственные ресурсы площадки; общие кэши моделей не трогает
  dispose() {
    this.group.parent?.remove(this.group);
    this.smoke.dispose();
    for (const w of Object.values(this.workers)) this.disposeWorker(w);
    for (const r of this.own) r.dispose?.();
    this.on = null;
  }

  update(dt) {
    this.time += dt;
    const T = this.time;
    this.decorUpdate?.(dt, T);                                 // окружение набора «Для опытных» (прораб, брошенная каска)
    for (const mc of this.machines.values()) {
      const p = mc.obj.userData.parts;
      const working = mc.state === "work";
      if (mc.kind === "truck") {
        if (working) mc.angle += dt * 0.35 * mc.speed;
        const [cx, cy] = this.loop.center;
        const out = working ? 1 : 1.22;                        // сломанный съезжает на обочину
        const x = cx + this.loop.rx * out * Math.cos(mc.angle), y = cy + this.loop.ry * out * Math.sin(mc.angle);
        mc.obj.position.lerp(P(x, y), working ? 1 : Math.min(1, dt * 3));
        const dx = -this.loop.rx * Math.sin(mc.angle), dy = this.loop.ry * Math.cos(mc.angle);
        mc.obj.rotation.y = Math.atan2(dy, dx);
        p.bed.rotation.z = working ? 0 : 0.35;
      } else if (mc.kind === "excavator") {
        if (working) {
          p.turret.rotation.y = Math.sin(T * 1.3 * mc.speed + mc.phase) * 1.1;
          p.boom.rotation.z = 0.25 + Math.sin(T * 2.6 * mc.speed + mc.phase) * 0.25;
          p.stick.rotation.z = -0.3 + Math.cos(T * 2.6 * mc.speed + mc.phase) * 0.35;
        } else p.boom.rotation.z = THREE.MathUtils.lerp(p.boom.rotation.z, -0.35, dt * 2);
      } else if (mc.kind === "bulldozer") {
        if (working) {
          mc.phase += dt * 0.5 * mc.speed;
          const s = Math.sin(mc.phase);
          mc.obj.position.x = mc.home.x + s * mc.span;
          mc.obj.rotation.y = Math.cos(mc.phase) >= 0 ? 0 : Math.PI;
        }
      } else if (mc.kind === "crane") {
        if (working) p.turret.rotation.y = Math.sin(T * 0.5 * mc.speed + mc.phase) * 0.6;
        const hp = new THREE.Vector3();
        p.hookAnchor.getWorldPosition(hp);
        mc.obj.worldToLocal(hp);
        const sway = working ? Math.sin(T * 2 + mc.phase) * 0.004 : 0;
        const loadY = 0.03 + (working ? Math.sin(T * 0.8 + mc.phase) * 0.012 : -0.01);
        p.load.position.set(hp.x + sway, loadY, hp.z);
        p.rope.position.set((hp.x + p.load.position.x) / 2, (hp.y + loadY) / 2, hp.z);
        p.rope.scale.y = Math.max(0.001, hp.y - loadY);
      }
      mc.obj.userData.update?.(dt, T, mc);                     // «Для опытных»: доп. анимация модели поверх классической
      if (!working) {
        mc.smokeT -= dt;
        if (mc.smokeT <= 0) {
          mc.smokeT = 0.18;
          const sp = mc.obj.position.clone();
          sp.y += 0.035;
          this.smoke.emit(sp);
        }
        mc.icon.position.y = mc.obj.userData.top + 0.022 + Math.sin(T * 5) * 0.003;
      }
    }
    this.smoke.update(dt);

    // слесари идут к назначенной машине или на базу
    const walk = 0.5 * (this.walkScale || 1);      // ходьба условная: в модели время перехода не учитывается
    const offsets = { 6: new THREE.Vector3(-0.01, 0, 0.026), 3: new THREE.Vector3(0.016, 0, 0.022) };
    for (const [g, w] of Object.entries(this.workers)) {
      let target;
      if (w.staged) target = w.staged.clone();                                   // сценка
      else if (w.leaving) target = w.target ? w.target.clone() : w.obj.position.clone();
      else if (w.job) target = w.job.obj.position.clone().add(offsets[g]);
      else target = this.basePos.clone().add(new THREE.Vector3(g === "6" ? -0.012 : 0.012, 0, 0));
      target.y = 0;
      const pos = w.obj.position;
      const d = target.clone().sub(pos);
      d.y = 0;
      const dist = d.length();
      const parts = w.obj.userData.parts;
      const moving = dist > 0.003;
      if (moving) {
        const stepLen = Math.min(dist, walk * dt);
        pos.add(d.multiplyScalar(stepLen / dist));
        w.obj.rotation.y = Math.atan2(-(target.z - pos.z), target.x - pos.x);
        parts.body.position.y = 0.016 + Math.abs(Math.sin(T * 14)) * 0.003;
        parts.wrench.rotation.z = 0;
      } else {
        parts.body.position.y = 0.016;
        if (!w.staged && w.job && w.job.state === "fix") {
          w.obj.lookAt(w.job.obj.position.x, 0, w.job.obj.position.z);
          w.obj.rotateY(-Math.PI / 2);
          parts.wrench.rotation.z = Math.sin(T * 16) * 0.8;
        } else parts.wrench.rotation.z = 0;
      }
      w.atJob = !moving && !w.staged && !w.leaving && w.job?.state === "fix";
      w.obj.userData.update?.(dt, T, { moving, working: w.atJob, leaving: w.leaving, walk, staged: !!w.staged });
      if (w.leaving && w.exitHold && (w.holdT += dt) > 20) this.releaseWorker(g);   // страховка: без режиссёра всё равно уйдёт
      if (w.leaving && !w.exitHold && !w.staged && w.target && !moving) {
        this.group.remove(w.obj);
        this.disposeWorker(w);
        delete this.workers[g];
        this.emit("gone", g);
      }
    }
  }
}
