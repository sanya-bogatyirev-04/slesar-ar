// Реалистичный набор моделей для режима «Для опытных»: PBR-материалы, детали сливаются
// в один меш на материал (мало вызовов отрисовки), грязь и износ — цветами вершин.
// Интерфейс тот же, что у CLASSIC_KIT в scene.js: машины смотрят по +x, начало — центр
// на земле; имена частей (turret, boom, stick, bed, hookAnchor, rope, load, body, wrench)
// и их шарниры совпадают с игрушечными, поэтому анимация Site работает без изменений.
// Загружается динамическим import() только при включении режима.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { labelSprite } from "./scene.js";

const P = (mx, my, y = 0) => new THREE.Vector3(mx, y, -my);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = THREE.MathUtils.lerp;

// ---------------------------------------------------------------------------
// Материалы (общие на весь набор)
// ---------------------------------------------------------------------------
function noiseTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.random() * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// атлас наклеек 512×256: зебра, решётка, жалюзи, фара, знак, номер, «!»
const ATLAS = { zebra: [0, 0, 128, 64], grille: [128, 0, 256, 64], louvre: [256, 0, 384, 64], lamp: [384, 0, 448, 64], warn: [448, 0, 512, 64], sign: [0, 64, 512, 128], plate: [0, 128, 256, 192] };
function atlasTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#1a1a1a"; x.fillRect(0, 0, 128, 64);
  x.fillStyle = "#f2c200";
  for (let i = -64; i < 192; i += 24) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 12, 64); x.lineTo(i + 76, 0); x.lineTo(i + 64, 0); x.fill(); }
  x.fillStyle = "#222"; x.fillRect(128, 0, 128, 64);
  x.fillStyle = "#555"; for (let i = 0; i < 9; i++) x.fillRect(134 + i * 13, 6, 6, 52);
  x.fillStyle = "#2b2b2b"; x.fillRect(256, 0, 128, 64);
  for (let i = 0; i < 8; i++) { x.fillStyle = "#121212"; x.fillRect(262, 4 + i * 7.5, 116, 3.5); }
  const g = x.createRadialGradient(416, 32, 2, 416, 32, 30);
  g.addColorStop(0, "#fffbe8"); g.addColorStop(0.5, "#f3e7b5"); g.addColorStop(1, "#555");
  x.fillStyle = g; x.fillRect(384, 0, 64, 64);
  x.fillStyle = "#c9a227"; x.fillRect(448, 0, 64, 64);
  x.fillStyle = "#f2c200"; x.beginPath(); x.moveTo(480, 6); x.lineTo(508, 58); x.lineTo(452, 58); x.fill();
  x.fillStyle = "#111"; x.font = "bold 36px Arial"; x.textAlign = "center"; x.fillText("!", 480, 54);
  x.fillStyle = "#f4f1e8"; x.fillRect(0, 64, 512, 64);
  x.strokeStyle = "#c0281e"; x.lineWidth = 6; x.strokeRect(3, 67, 506, 58);
  x.fillStyle = "#c0281e"; x.font = "bold 34px Arial"; x.textBaseline = "middle"; x.fillText("НЕ СТОЯТЬ ПОД СТРЕЛОЙ", 256, 97);
  x.fillStyle = "#f4f1e8"; x.fillRect(0, 128, 256, 64);
  x.strokeStyle = "#111"; x.lineWidth = 4; x.strokeRect(4, 132, 248, 56);
  x.fillStyle = "#111"; x.font = "bold 34px Arial"; x.fillText("СМУ-7 № 12", 128, 161);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let MATS = null;
const paintCache = new Map();
function mats() {
  if (MATS) return MATS;
  const rough = noiseTexture();
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.7, ...o });
  MATS = {
    rough,
    dark: std({ vertexColors: true, color: "#ffffff", roughness: 0.85, metalness: 0.35 }),
    steel: std({ vertexColors: true, color: "#8c8d8a", roughness: 0.45, metalness: 0.85 }),
    chrome: std({ color: "#d6d6d6", roughness: 0.15, metalness: 1 }),
    glass: std({ color: "#1d2a31", roughness: 0.06, metalness: 0.2, envMapIntensity: 1.2 }),
    glassLow: std({ color: "#1d2a31", roughness: 0.4, metalness: 0.2 }),
    decal: std({ map: atlasTexture(), roughness: 0.6, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }),
    figure: std({ vertexColors: true, color: "#ffffff", roughness: 0.8, metalness: 0 }),
    concrete: std({ vertexColors: true, color: "#ffffff", roughness: 0.95, metalness: 0 }),
    foliage: std({ vertexColors: true, color: "#ffffff", roughness: 0.9, metalness: 0, flatShading: true }),
    beacon: new THREE.MeshBasicMaterial({ color: "#ffae00" }),
    rope: std({ color: "#2a2a2a", roughness: 0.7, metalness: 0.6 }),
  };
  return MATS;
}
function paint(tint) {
  if (!paintCache.has(tint)) paintCache.set(tint, new THREE.MeshStandardMaterial({ vertexColors: true, color: tint, roughness: 0.62, metalness: 0.25, roughnessMap: mats().rough, envMapIntensity: 0.7 }));
  return paintCache.get(tint);
}

// ---------------------------------------------------------------------------
// Сборщик: детали копятся по слотам материалов и сливаются в один меш на слот
// ---------------------------------------------------------------------------
const DIRT = new THREE.Color(0.62, 0.52, 0.4);
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();

class PB {
  // y0 — высота начала координат детали над землёй (для грязи снизу)
  // remap — перенос мелких деталей в другой слот (меньше вызовов отрисовки)
  constructor(y0 = 0, remap = null) { this.y0 = y0; this.slots = {}; this.remap = remap || {}; }
  add(geo, slot, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}, color = "#ffffff", { dirt = true, wear = false } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.clearGroups();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _m.compose(V(...p), _q.setFromEuler(_e.set(...r)), V(...s));
    g.applyMatrix4(_m);
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3);
    const base = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      _c.copy(base);
      if (dirt) {
        const f = THREE.MathUtils.smoothstep(y + this.y0, 0, 0.014);
        _c.r *= lerp(DIRT.r, 1, f); _c.g *= lerp(DIRT.g, 1, f); _c.b *= lerp(DIRT.b, 1, f);
      }
      const k = 1 + 0.06 * (hash(x * 900, y * 900, z * 900) - 0.5);
      _c.multiplyScalar(k);
      if (wear && hash(x * 400, z * 400, y * 50) > 0.6) _c.lerp(new THREE.Color("#b9b4aa"), 0.5);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    slot = this.remap[slot] || slot;
    (this.slots[slot] ||= []).push(g);
    return this;
  }
  merge() {
    const out = {};
    for (const [slot, list] of Object.entries(this.slots)) out[slot] = mergeGeometries(list, false);
    return out;
  }
}

// кэш слитых геометрий по ключу «вид:детализация:часть»; экземпляры делят геометрию и материалы
const GEO = new Map();
const NOSTEEL = { steel: "dark" };             // мелкие стальные детали (пальцы, зубья, ступени) — в «тёмный» слот
function part(key, build, y0 = 0, remap = null) {
  if (!GEO.has(key)) { const pb = new PB(y0, remap); build(pb); GEO.set(key, pb.merge()); }
  return GEO.get(key);
}
function inst(geoms, tint, low = false) {
  const g = new THREE.Group();
  const M = mats();
  for (const [slot, geo] of Object.entries(geoms)) {
    const m = slot === "paint" ? paint(tint) : slot === "glass" && low ? M.glassLow : M[slot];
    g.add(new THREE.Mesh(geo, m));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Геометрические заготовки
// ---------------------------------------------------------------------------
const gBox = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const gCyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
function gExtrude(pts, depth, bevel = 0.0003) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function gDecal(w, h, region) {
  const g = new THREE.PlaneGeometry(w, h);
  const [x0, y0, x1, y1] = region;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) ? x1 : x0) / 512, 1 - (uv.getY(i) ? y0 : y1) / 256);
  return g;
}
// цилиндр между двумя точками
function rodBetween(pb, a, b, r, slot, color, seg = 8) {
  const d = b.clone().sub(a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  pb.add(gCyl(r, r, len, seg), slot, { p: a.clone().add(b).multiplyScalar(0.5).toArray(), r: [e.x, e.y, e.z] }, color);
}

// гусеница: рама, башмаки по «стадиону», катки, ленивец и звёздочка
function trackLoop(pb, { len, h, w, z, rollers = 5, detail, shoes = "all" }) {
  const R = h / 2 - 0.0004, half = len / 2 - R, cy = h / 2;
  pb.add(gBox(len - 2 * R, h * 0.5, w * 0.7), "dark", { p: [0, cy, z] }, "#3a3a38");
  if (shoes !== "none") {
    const pitch = 0.0042;
    const per = 2 * (2 * half) + 2 * Math.PI * R;
    const nn = Math.round(per / (detail === "low" ? pitch * 1.6 : pitch));
    for (let i = 0; i < nn; i++) {
      let s = (i / nn) * per, x, y, ang;
      if (s < 2 * half) { x = -half + s; y = cy - R; ang = 0; }
      else if ((s -= 2 * half) < Math.PI * R) { const a = -Math.PI / 2 + s / R; x = half + R * Math.cos(a); y = cy + R * Math.sin(a); ang = a + Math.PI / 2; }
      else if ((s -= Math.PI * R) < 2 * half) { x = half - s; y = cy + R; ang = Math.PI; }
      else { s -= 2 * half; const a = Math.PI / 2 + s / R; x = -half + R * Math.cos(a); y = cy + R * Math.sin(a); ang = a + Math.PI / 2; }
      const straight = Math.abs(ang) < 1e-6 || Math.abs(ang - Math.PI) < 1e-6;
      if (shoes === "ends" && straight) continue;
      pb.add(gBox(0.0036, 0.0008, w), "steel", { p: [x, y, z], r: [0, 0, ang] }, "#77746e", { wear: true });
    }
  }
  for (const sx of [-1, 1]) pb.add(gCyl(R * 0.85, R * 0.85, w * 0.8, 12), "steel", { p: [sx * half, cy, z], r: [Math.PI / 2, 0, 0] }, "#6d6a64");
  for (let i = 0; i < rollers; i++) pb.add(gCyl(0.0016, 0.0016, w * 0.6, 8), "dark", { p: [-half + ((i + 0.5) / rollers) * 2 * half, 0.0022, z], r: [Math.PI / 2, 0, 0] }, "#2c2c2a");
}
// прямые ветви башмаков отдельно — для «бегущих» траков бульдозера
function shoeRun(pb, { len, h, w, z, top }) {
  const R = h / 2 - 0.0004, half = len / 2 - R, cy = h / 2, pitch = 0.0042;
  for (let x = -half; x <= half + 1e-6; x += pitch) pb.add(gBox(0.0036, 0.0008, w), "steel", { p: [x, top ? cy + R : cy - R, z] }, "#77746e", { wear: true });
}

// колесо: шина, протектор «ёлкой», диск; ось вдоль z
function wheel(pb, { x, y, z, r, w, dual = false, detail }) {
  const seg = detail === "low" ? 10 : 16;
  const ww = dual ? w * 1.9 : w;
  pb.add(gCyl(r, r, ww, seg), "dark", { p: [x, y, z], r: [Math.PI / 2, 0, 0] }, "#232323");
  if (dual) pb.add(gCyl(r * 0.97, r * 0.97, w * 0.15, seg), "dark", { p: [x, y, z], r: [Math.PI / 2, 0, 0] }, "#111");
  if (detail !== "low") for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    pb.add(gBox(0.0012, 0.0006, ww * 0.42), "dark", { p: [x + Math.cos(a) * r, y + Math.sin(a) * r, z + (i % 2 ? 1 : -1) * ww * 0.22], r: [0, 0, a + Math.PI / 2], s: [1, 1, 1] }, "#1c1c1c", { dirt: false });
  }
  const side = Math.sign(z) || 1;
  pb.add(gCyl(r * 0.55, r * 0.55, 0.0006, seg), "dark", { p: [x, y, z + side * ww / 2], r: [Math.PI / 2, 0, 0] }, "#8a8a84", { dirt: false });
  pb.add(gCyl(r * 0.2, r * 0.2, 0.0012, 8), "dark", { p: [x, y, z + side * (ww / 2 + 0.0004)], r: [Math.PI / 2, 0, 0] }, "#5a5a55", { dirt: false });
}

// кабина: стойки, крыша со свесом, утопленные стёкла, зеркало
function cabFrame(pb, { x, y, z, w, h, d, low, roofColor = null }) {
  const t = 0.0012;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pb.add(gBox(t, h, t), "paint", { p: [x + sx * (w / 2 - t / 2), y + h / 2, z + sz * (d / 2 - t / 2)] });
  pb.add(gBox(w + 0.0016, 0.0012, d + 0.0016), "paint", { p: [x, y + h + 0.0006, z] }, roofColor || "#ffffff");
  pb.add(gBox(w, h * 0.3, d), "paint", { p: [x, y + h * 0.15, z] });
  const gslot = low ? "dark" : "glass";
  const gc = low ? "#1d2a31" : "#ffffff";
  pb.add(gBox(w - t, h * 0.68, 0.0003), gslot, { p: [x, y + h * 0.64, z + d / 2 - 0.0007] }, gc, { dirt: false });
  pb.add(gBox(w - t, h * 0.68, 0.0003), gslot, { p: [x, y + h * 0.64, z - d / 2 + 0.0007] }, gc, { dirt: false });
  pb.add(gBox(0.0003, h * 0.7, d - t), gslot, { p: [x + w / 2 - 0.0005, y + h * 0.64, z], r: [0, 0, 0.08] }, gc, { dirt: false });
  pb.add(gBox(0.0003, h * 0.68, d - t), gslot, { p: [x - w / 2 + 0.0007, y + h * 0.64, z] }, gc, { dirt: false });
  if (!low) {
    pb.add(gBox(0.0002, h * 0.4, 0.0003), "dark", { p: [x + w / 2 + 0.0001, y + h * 0.6, z], r: [0.6, 0, 0] }, "#111", { dirt: false });   // дворник
    pb.add(gBox(0.0012, 0.0018, 0.0003), "dark", { p: [x + w / 2, y + h * 0.75, z - d / 2 - 0.0016] }, "#222", { dirt: false });     // зеркало
    pb.add(gBox(0.0003, 0.0003, 0.0016), "dark", { p: [x + w / 2, y + h * 0.75, z - d / 2 - 0.0008] }, "#222", { dirt: false });
  }
}

// мягкая тень: один материал на набор
let SHADOW = null;
function blobShadow(parent, rx, rz) {
  if (!SHADOW) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.6, "rgba(0,0,0,0.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    SHADOW = { geo: new THREE.PlaneGeometry(2, 2), mat: new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.45, depthWrite: false }) };
  }
  const m = new THREE.Mesh(SHADOW.geo, SHADOW.mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(rx, rz, 1);
  m.position.y = 0.0008;
  parent.add(m);
  return m;
}

function beacon(parent, x, y, z) {
  const geo = part("beacon", (pb) => pb.add(gCyl(0.0011, 0.0013, 0.0018, 10), "beacon", {}, "#ffffff", { dirt: false }));
  const m = new THREE.Mesh(geo.beacon, mats().beacon);
  m.position.set(x, y, z);
  m.visible = false;
  parent.add(m);
  return m;
}

// гидроцилиндр: гильза в точке A (группа-родитель), шток — в точке B (Object3D в дочерней группе)
function makeRam(parent, a, child, b, { barrel, rod, rB = 0.0011, rR = 0.0006, stages = 1, tint }) {
  const geos = part(`ram:${barrel}:${rod}:${rB}`, (pb) => {
    pb.add(gCyl(rB, rB, barrel, 10).translate(0, barrel / 2, 0), "paint", {}, "#ffffff", { dirt: false });
  });
  const barrelM = new THREE.Mesh(geos.paint, paint(tint));
  const rodGeo = part(`rod:${rod}:${rR}`, (pb) => pb.add(gCyl(rR, rR, rod, 8).translate(0, rod / 2, 0), "chrome", {}, "#ffffff", { dirt: false }));
  const rodM = new THREE.Mesh(rodGeo.chrome, mats().chrome);
  let mid = null;
  if (stages > 1) {
    const mg = part(`ramMid:${(rB + rR) / 2}`, (pb) => pb.add(gCyl((rB + rR) / 2, (rB + rR) / 2, 1, 8).translate(0, 0.5, 0), "chrome", {}, "#ffffff", { dirt: false }));
    mid = new THREE.Mesh(mg.chrome, mats().chrome);
    parent.add(mid);
  }
  parent.add(barrelM, rodM);
  const A = new THREE.Object3D(); A.position.copy(a); parent.add(A);
  const B = new THREE.Object3D(); B.position.copy(b); child.add(B);
  const pB = new THREE.Vector3(), dir = new THREE.Vector3();
  const update = () => {
    child.updateMatrix();                                  // Site только что поменял углы
    pB.copy(B.position).applyMatrix4(child.matrix);
    dir.copy(pB).sub(A.position);
    const d = dir.length();
    dir.normalize();
    barrelM.position.copy(A.position);
    barrelM.quaternion.setFromUnitVectors(Y, dir);
    rodM.position.copy(pB);
    rodM.quaternion.setFromUnitVectors(Y, dir.clone().negate());
    if (mid) {
      mid.position.copy(A.position).addScaledVector(dir, barrel * 0.85);
      mid.quaternion.copy(barrelM.quaternion);
      mid.scale.y = Math.max(0.0005, d - barrel * 0.85 - rod * 0.85);
    }
  };
  update();
  return update;
}

// ---------------------------------------------------------------------------
// Экскаватор (класс 20 т)
// ---------------------------------------------------------------------------
const BOOM_PTS = [[-0.004, 0.003], [0.012, 0.0115], [0.026, 0.0155], [0.04, 0.009], [0.052, 0.002], [0.052, -0.002], [0.04, 0.005], [0.026, 0.0085], [0.012, 0.004], [-0.004, -0.004]];
const STICK_PTS = [[-0.0045, 0.0085], [0.003, 0.007], [0.0025, -0.035], [-0.0022, -0.035], [-0.004, -0.002]];
const BUCKET_PTS = [[-0.002, 0.003], [0.004, 0.001], [0.007, -0.004], [0.0065, -0.009], [0.001, -0.0115], [-0.004, -0.0095], [-0.0055, -0.003]];

function makeExcavator(tint, detail = "high") {
  const low = detail === "low";
  const g = new THREE.Group();
  g.add(inst(part(`exc:${detail}:under`, (pb) => {
    for (const z of [-0.0165, 0.0165]) trackLoop(pb, { len: 0.06, h: 0.0125, w: 0.0085, z, detail });
    pb.add(gBox(0.03, 0.005, 0.026), "dark", { p: [0, 0.008, 0] }, "#2f2f2d");
    pb.add(gCyl(0.012, 0.012, 0.003, 20), "dark", { p: [0, 0.0135, 0] }, "#3a3a38");
  }), tint, low));
  const turret = new THREE.Group();
  turret.position.y = 0.015;
  g.add(turret);
  turret.add(inst(part(`exc:${detail}:turret`, (pb) => {
    pb.add(gBox(0.042, 0.004, 0.03), "paint", { p: [-0.002, 0.002, 0] });
    pb.add(gBox(0.03, 0.011, 0.018), "paint", { p: [-0.008, 0.0095, 0.0055] });                 // капот
    pb.add(gBox(0.01, 0.013, 0.03), "paint", { p: [-0.022, 0.0075, 0] }, "#3b3a36");              // противовес
    pb.add(gCyl(0.0065, 0.0065, 0.03, 16), "paint", { p: [-0.027, 0.0075, 0], r: [Math.PI / 2, 0, 0] }, "#3b3a36");
    pb.add(gBox(0.012, 0.009, 0.009), "paint", { p: [0.012, 0.0085, 0.011] });                   // бак справа
    cabFrame(pb, { x: 0.006, y: 0.004, z: -0.0085, w: 0.014, h: 0.016, d: 0.011, low });
    pb.add(gCyl(0.0008, 0.0008, 0.007, 8), "dark", { p: [-0.012, 0.018, 0.009] }, "#222");      // выхлоп
    pb.add(gCyl(0.0011, 0.0008, 0.0012, 8), "dark", { p: [-0.012, 0.0215, 0.009] }, "#222");
    if (!low) {
      pb.add(gDecal(0.012, 0.016, ATLAS.louvre), "decal", { p: [-0.008, 0.0151, 0.0055], r: [-Math.PI / 2, 0, 0] });
      pb.add(gDecal(0.026, 0.008, ATLAS.zebra), "decal", { p: [-0.0336, 0.0075, 0], r: [0, -Math.PI / 2, 0] });
      pb.add(gDecal(0.012, 0.004, ATLAS.plate), "decal", { p: [-0.008, 0.008, 0.0146] });
      for (const x of [0.004, 0.012, 0.018]) pb.add(gBox(0.0006, 0.004, 0.0006), "paint", { p: [x, 0.015, 0.015] }, "#f2c200");   // поручни
      pb.add(gBox(0.015, 0.0006, 0.0006), "paint", { p: [0.011, 0.017, 0.015] }, "#f2c200");
      for (let i = 0; i < 3; i++) pb.add(gBox(0.003, 0.0005, 0.003), "steel", { p: [0.013 - i * 0.002, 0.001 + i * 0.0025, -0.016] }, "#888");   // ступени
    }
  }, 0.015, NOSTEEL), tint, low));
  const bc = beacon(turret, 0.004, 0.0215, -0.0085);
  const boom = new THREE.Group();
  boom.position.set(0.012, 0.009, 0.004);
  turret.add(boom);
  boom.add(inst(part(`exc:${detail}:boom`, (pb) => {
    pb.add(gExtrude(BOOM_PTS, 0.0055), "paint");
    pb.add(gCyl(0.0018, 0.0018, 0.0068, 10), "steel", { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }, "#888");
    pb.add(gCyl(0.0016, 0.0016, 0.0064, 10), "steel", { p: [0.05, 0, 0], r: [Math.PI / 2, 0, 0] }, "#888");
    if (!low) {
      const hose = new THREE.CatmullRomCurve3([V(0.002, 0.006, 0.002), V(0.026, 0.0175, 0.002), V(0.048, 0.004, 0.002)]);
      pb.add(new THREE.TubeGeometry(hose, 16, 0.0005, 6), "dark", {}, "#151515", { dirt: false });
      pb.add(new THREE.TubeGeometry(hose, 16, 0.0005, 6), "dark", { p: [0, 0, -0.0035] }, "#151515", { dirt: false });
      pb.add(gBox(0.0016, 0.0016, 0.0016), "dark", { p: [0.024, 0.017, -0.003] }, "#222");
    }
  }, 0.024, NOSTEEL), tint, low));
  const stick = new THREE.Group();
  stick.position.set(0.05, 0, 0);
  boom.add(stick);
  stick.add(inst(part(`exc:${detail}:stick`, (pb) => {
    pb.add(gExtrude(STICK_PTS, 0.0045), "paint");
    pb.add(gCyl(0.0014, 0.0014, 0.0058, 10), "steel", { p: [0, -0.035, 0], r: [Math.PI / 2, 0, 0] }, "#888");
  }, 0.02, NOSTEEL), tint, low));
  const bucket = new THREE.Group();
  bucket.position.set(0, -0.035, 0);
  stick.add(bucket);
  bucket.add(inst(part(`exc:${detail}:bucket`, (pb) => {
    pb.add(gExtrude(BUCKET_PTS, 0.011, 0.0002), "dark", {}, "#4a4945", { wear: true });
    pb.add(gBox(0.0012, 0.0014, 0.0116), "steel", { p: [0.0066, -0.0093, 0], r: [0, 0, 0.4] }, "#9a968e", { wear: true });
    for (let i = 0; i < 5; i++) pb.add(new THREE.ConeGeometry(0.0007, 0.003, 4), "steel", { p: [0.0078, -0.0096, -0.0044 + i * 0.0022], r: [0, 0, -Math.PI / 2 - 0.4] }, "#b9b4aa", { dirt: false });
    pb.add(new THREE.IcosahedronGeometry(0.0034, 0), "dark", { p: [0.001, -0.004, 0], s: [1.2, 0.8, 1.4] }, "#6b4a2b");
  }, 0.005, NOSTEEL), tint, low));
  blobShadow(g, 0.045, 0.034);
  const rams = [];
  if (!low) {
    rams.push(makeRam(turret, V(0.016, 0.003, 0.004), boom, V(0.02, -0.002, 0), { barrel: 0.012, rod: 0.012, tint }));
    rams.push(makeRam(boom, V(0.022, 0.0165, 0), stick, V(-0.003, 0.007, 0), { barrel: 0.018, rod: 0.014, rB: 0.001, tint }));
    rams.push(makeRam(stick, V(-0.003, -0.008, 0), bucket, V(-0.004, 0.003, 0), { barrel: 0.013, rod: 0.012, rB: 0.0009, rR: 0.0005, tint }));
  }
  g.userData.parts = { turret, boom, stick, bucket };
  g.userData.top = 0.07;
  g.userData.update = (dt, T, mc) => {
    const working = mc.state === "work";
    if (working) bucket.rotation.z = -0.4 + Math.cos(T * 2.6 * mc.speed + mc.phase + 0.6) * 0.5;   // ковш захватывает в такт с рукоятью
    else bucket.rotation.z = lerp(bucket.rotation.z, -0.9, Math.min(1, dt * 2));
    bc.visible = !working && ((T * 4) | 0) % 2 === 0;
    for (const r of rams) r();
  };
  return g;
}

// ---------------------------------------------------------------------------
// Бульдозер (класс D6)
// ---------------------------------------------------------------------------
const BLADE_PTS = [[0, -0.011], [0.0025, -0.011], [0.0006, -0.004], [0.0006, 0.004], [0.0035, 0.011], [0.001, 0.0112], [-0.0015, 0.004], [-0.0015, -0.004]];

function makeBulldozer(tint, detail = "high") {
  const low = detail === "low";
  const g = new THREE.Group();
  const tr = { len: 0.05, h: 0.012, w: 0.009 };
  g.add(inst(part(`bul:${detail}:body`, (pb) => {
    for (const z of [-0.016, 0.016]) trackLoop(pb, { ...tr, z, rollers: 6, detail, shoes: low ? "all" : "ends" });
    pb.add(gBox(0.036, 0.01, 0.023), "paint", { p: [-0.002, 0.016, 0] });
    pb.add(gBox(0.022, 0.009, 0.016), "paint", { p: [0.008, 0.0245, 0] });                       // капот
    pb.add(gBox(0.008, 0.009, 0.02), "paint", { p: [-0.021, 0.0205, 0] }, "#3b3a36");             // бак
    cabFrame(pb, { x: -0.011, y: 0.021, z: 0, w: 0.014, h: 0.016, d: 0.019, low });
    pb.add(gCyl(0.0009, 0.0009, 0.012, 8), "dark", { p: [0.014, 0.034, 0.005] }, "#1d1d1d");     // выхлоп
    pb.add(gBox(0.0026, 0.0004, 0.0026), "dark", { p: [0.014, 0.0402, 0.005], r: [0, 0, 0.4] }, "#1d1d1d");
    pb.add(gCyl(0.0015, 0.0015, 0.007, 10), "dark", { p: [0.014, 0.032, -0.005] }, "#2a2a2a");   // воздухоочиститель
    // толкающие брусья и цилиндры подъёма отвала
    for (const z of [-0.0185, 0.0185]) rodBetween(pb, V(0.004, 0.006, z), V(0.03, 0.006, z * 1.05), 0.0012, "paint", "#ffffff");
    for (const z of [-0.008, 0.008]) {
      rodBetween(pb, V(0.017, 0.026, z), V(0.024, 0.018, z), 0.0011, "paint", "#ffffff");
      rodBetween(pb, V(0.022, 0.02, z), V(0.029, 0.013, z), 0.0006, "chrome", "#ffffff");
    }
    // рыхлитель сзади
    pb.add(gBox(0.004, 0.003, 0.02), "paint", { p: [-0.029, 0.011, 0] }, "#3b3a36");
    pb.add(gBox(0.002, 0.012, 0.003), "steel", { p: [-0.031, 0.006, 0], r: [0, 0, 0.25] }, "#77746e", { wear: true });
    for (const z of [-0.006, 0.006]) rodBetween(pb, V(-0.024, 0.02, z), V(-0.029, 0.012, z), 0.0008, "chrome", "#ffffff");
    if (!low) {
      for (const s of [-1, 1]) pb.add(gDecal(0.014, 0.006, ATLAS.louvre), "decal", { p: [0.009, 0.0245, s * 0.0081], r: [0, s < 0 ? Math.PI : 0, 0] });
      pb.add(gDecal(0.012, 0.007, ATLAS.grille), "decal", { p: [0.0191, 0.0245, 0], r: [0, Math.PI / 2, 0] });
      for (const z of [-0.006, 0.006]) pb.add(gDecal(0.002, 0.002, ATLAS.lamp), "decal", { p: [-0.0039, 0.0375, z], r: [0, Math.PI / 2, 0] });
      for (const z of [-0.008, 0.008]) pb.add(gBox(0.002, 0.0006, 0.0006), "paint", { p: [-0.004, 0.0385, z] }, "#f2c200");
    }
  }), tint, low));
  // отвал: вогнутый профиль, ножи, щёки
  const blade = new THREE.Group();
  blade.position.set(0.032, 0.012, 0);
  g.add(blade);
  blade.add(inst(part(`bul:${detail}:blade`, (pb) => {
    pb.add(gExtrude(BLADE_PTS, 0.052, 0.0002), "paint");
    pb.add(gBox(0.0012, 0.0016, 0.052), "steel", { p: [0.0016, -0.0108, 0] }, "#9a968e", { wear: true });
    for (const s of [-1, 1]) pb.add(gBox(0.004, 0.02, 0.0008), "paint", { p: [0.0005, 0, s * 0.0262] });
    pb.add(new THREE.IcosahedronGeometry(0.004, 0), "dark", { p: [0.004, -0.009, 0.004], s: [1.2, 0.6, 2.4] }, "#6b4a2b");
  }, 0.012, NOSTEEL), tint, low));
  // звёздочки (крутятся) и «бегущие» траки
  const spr = new THREE.Group();
  spr.position.set(-0.0195, 0.006, 0);
  g.add(spr);
  spr.add(inst(part(`bul:sprocket`, (pb) => {
    for (const z of [-0.016, 0.016]) {
      pb.add(gCyl(0.0052, 0.0052, 0.004, 9), "steel", { p: [0, 0, z], r: [Math.PI / 2, 0, 0] }, "#5d5a54");
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; pb.add(gBox(0.0014, 0.0014, 0.003), "steel", { p: [Math.cos(a) * 0.0056, Math.sin(a) * 0.0056, z], r: [0, 0, a] }, "#77746e"); }
    }
  }, 0.006), tint, low));
  let shoesTop = null, shoesBot = null;
  if (!low) {
    shoesTop = inst(part("bul:shoesTop", (pb) => { for (const z of [-0.016, 0.016]) shoeRun(pb, { ...tr, z, top: true }); }), tint);
    shoesBot = inst(part("bul:shoesBot", (pb) => { for (const z of [-0.016, 0.016]) shoeRun(pb, { ...tr, z, top: false }); }), tint);
    g.add(shoesTop, shoesBot);
  }
  const bc = beacon(g, -0.011, 0.0385, 0);
  blobShadow(g, 0.04, 0.032);
  g.userData.parts = { blade };
  g.userData.top = 0.06;
  let lastX = null, s = 0;
  g.userData.update = (dt, T, mc) => {
    const working = mc.state === "work";
    const x = g.position.x;
    if (lastX !== null && dt > 0) {
      const dx = (x - lastX) * Math.cos(g.rotation.y);     // путь вперёд по своей оси
      s += dx;
      spr.rotation.z -= dx / 0.0052;
      if (shoesTop) { const k = ((s % 0.0042) + 0.0042) % 0.0042; shoesBot.position.x = -k; shoesTop.position.x = k; }
    }
    lastX = x;
    blade.position.y = lerp(blade.position.y, working ? 0.012 : 0.0085, Math.min(1, dt * 2));   // сломан — отвал на земле
    bc.visible = !working && ((T * 4) | 0) % 2 === 0;
  };
  return g;
}

// ---------------------------------------------------------------------------
// Кабина грузовика (общая для автокрана и самосвала)
// ---------------------------------------------------------------------------
function truckCab(pb, { x, low }) {
  const w = 0.013, h = 0.017, d = 0.024, y = 0.012;
  pb.add(gExtrude([[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.55], [w / 2 - 0.002, h], [-w / 2, h]], d, 0.0006), "paint", { p: [x, y, 0] });
  const gslot = low ? "dark" : "glass";
  const gc = low ? "#1d2a31" : "#ffffff";
  for (const z of [-0.0055, 0.0055]) pb.add(gBox(0.0003, h * 0.38, 0.0104), gslot, { p: [x + w / 2 - 0.0005, y + h * 0.75, z], r: [0, 0, 0.25] }, gc, { dirt: false });
  for (const s of [-1, 1]) pb.add(gBox(w * 0.55, h * 0.34, 0.0003), gslot, { p: [x + 0.0012, y + h * 0.74, s * (d / 2 + 0.0006)] }, gc, { dirt: false });
  pb.add(gBox(0.002, 0.003, d + 0.001), "dark", { p: [x + w / 2 + 0.0004, y + 0.0015, 0] }, "#2a2a2a");     // бампер
  pb.add(gBox(0.003, 0.0008, d + 0.002), "paint", { p: [x + w / 2 - 0.0005, y + h + 0.0004, 0] });         // козырёк
  for (const s of [-1, 1]) {
    pb.add(gBox(0.0012, 0.003, 0.0004), "dark", { p: [x + w / 2 + 0.0004, y + h * 0.72, s * (d / 2 + 0.0026)] }, "#1b1b1b", { dirt: false });   // зеркала
    pb.add(gBox(0.0004, 0.0004, 0.0024), "dark", { p: [x + w / 2 + 0.0002, y + h * 0.78, s * (d / 2 + 0.0013)] }, "#1b1b1b", { dirt: false });
  }
  if (!low) {
    pb.add(gDecal(0.0075, 0.0045, ATLAS.grille), "decal", { p: [x + w / 2 + 0.0007, y + 0.005, 0], r: [0, Math.PI / 2, 0] });
    for (const s of [-1, 1]) pb.add(gDecal(0.003, 0.002, ATLAS.lamp), "decal", { p: [x + w / 2 + 0.0016, y + 0.0016, s * 0.009], r: [0, Math.PI / 2, 0] });
    pb.add(gDecal(0.006, 0.0016, ATLAS.plate), "decal", { p: [x + w / 2 + 0.0016, y - 0.0006, 0], r: [0, Math.PI / 2, 0] });
  }
}

// ---------------------------------------------------------------------------
// Автокран (КС-55713 на шасси 6×4)
// ---------------------------------------------------------------------------
function makeCrane(tint, detail = "high") {
  const low = detail === "low";
  const g = new THREE.Group();
  const axles = [0.024, -0.016, -0.028];
  g.add(inst(part(`crn:${detail}:chassis`, (pb) => {
    pb.add(gBox(0.074, 0.004, 0.016), "dark", { p: [0, 0.01, 0] }, "#262626");
    pb.add(gBox(0.052, 0.003, 0.025), "paint", { p: [-0.008, 0.0155, 0] });
    truckCab(pb, { x: 0.03, low });
    for (const x of axles) for (const z of [-0.0115, 0.0115]) pb.add(gBox(0.017, 0.0008, 0.0062), "paint", { p: [x, 0.0148, z] }, "#2c2c2c");   // крылья
    for (const x of axles) wheel(pb, { x, y: 0.0068, z: -0.0115, r: 0.0068, w: 0.005, detail }), wheel(pb, { x, y: 0.0068, z: 0.0115, r: 0.0068, w: 0.005, detail });
    pb.add(gBox(0.01, 0.004, 0.003), "steel", { p: [0.008, 0.0085, -0.011] }, "#9c9c98");                  // бак
    // выдвинутые аутригеры: балки, домкраты, подушки на земле
    for (const x of [0.019, -0.03]) for (const s of [-1, 1]) {
      pb.add(gBox(0.004, 0.003, 0.02), "paint", { p: [x, 0.0105, s * 0.017] }, "#ffffff");
      pb.add(gCyl(0.0013, 0.0013, 0.009, 8), "paint", { p: [x, 0.0055, s * 0.026] }, "#ffffff");
      pb.add(gBox(0.006, 0.0008, 0.006), "dark", { p: [x, 0.0004, s * 0.026] }, "#3a3a38");
      if (!low) pb.add(gDecal(0.0035, 0.0025, ATLAS.zebra), "decal", { p: [x, 0.0105, s * 0.0272], r: [0, s < 0 ? Math.PI : 0, 0] });
    }
    pb.add(gCyl(0.009, 0.009, 0.007, 20), "dark", { p: [-0.014, 0.0205, 0] }, "#333");                     // опорно-поворотный круг
  }, 0, NOSTEEL), tint, low));
  const turret = new THREE.Group();
  turret.position.set(-0.014, 0.024, 0);
  g.add(turret);
  turret.add(inst(part(`crn:${detail}:turret`, (pb) => {
    pb.add(gBox(0.028, 0.004, 0.022), "paint", { p: [-0.002, 0.002, 0] });
    pb.add(gBox(0.009, 0.011, 0.0075), "paint", { p: [0.006, 0.0095, -0.0075] });                         // кабина крановщика
    pb.add(gBox(0.0003, 0.007, 0.0065), low ? "dark" : "glass", { p: [0.0106, 0.0105, -0.0075] }, low ? "#1d2a31" : "#ffffff", { dirt: false });
    pb.add(gBox(0.007, 0.006, 0.0003), low ? "dark" : "glass", { p: [0.006, 0.0105, -0.0113] }, low ? "#1d2a31" : "#ffffff", { dirt: false });
    pb.add(gBox(0.009, 0.01, 0.02), "paint", { p: [-0.0135, 0.008, 0] }, "#3b3a36");                      // противовес
    pb.add(gCyl(0.003, 0.003, 0.008, 14), "dark", { p: [-0.005, 0.0085, 0.004], r: [Math.PI / 2, 0, 0] }, "#2a2a2a");   // барабан лебёдки
    if (!low) for (let i = 0; i < 7; i++) pb.add(new THREE.TorusGeometry(0.0031, 0.0003, 4, 14), "steel", { p: [-0.005, 0.0085, 0.0008 + i * 0.001] }, "#555");
    // цилиндр подъёма стрелы (стрела не качается — цилиндр статичен)
    rodBetween(pb, V(0.012, 0.004, 0), V(0.024, 0.024, 0), 0.0015, "paint", "#ffffff");
    rodBetween(pb, V(0.02, 0.018, 0), V(0.0273, 0.0332, 0), 0.0008, "chrome", "#ffffff");
  }, 0.024, NOSTEEL), tint, low));
  const bc = beacon(turret, 0.006, 0.0157, -0.0075);
  const boom = new THREE.Group();
  boom.position.set(0.006, 0.012, 0);
  boom.rotation.z = 0.85;
  turret.add(boom);
  boom.add(inst(part(`crn:${detail}:boom`, (pb) => {
    const seg = low ? 8 : 8;
    const sec = (x0, x1, r, c) => pb.add(gCyl(r, r, x1 - x0, seg), "paint", { p: [(x0 + x1) / 2, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.85] }, c);
    sec(-0.004, 0.07, 0.0042, "#ffffff");
    sec(0.06, 0.11, 0.0034, "#f2f0ea");
    sec(0.1, 0.133, 0.0027, "#ffffff");
    pb.add(gBox(0.006, 0.0055, 0.004), "paint", { p: [0.133, -0.0005, 0] }, "#3b3a36");                    // оголовок
    for (const z of [-0.0012, 0.0012]) pb.add(gCyl(0.0022, 0.0022, 0.0008, 12), "steel", { p: [0.134, -0.0005, z], r: [Math.PI / 2, 0, 0] }, "#888");
    pb.add(gCyl(0.0024, 0.0024, 0.009, 10), "steel", { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }, "#777");
    if (!low) {
      pb.add(gDecal(0.03, 0.0035, ATLAS.sign), "decal", { p: [0.035, 0, 0.0039] });
      pb.add(gDecal(0.03, 0.0035, ATLAS.sign), "decal", { p: [0.035, 0, -0.0039], r: [0, Math.PI, 0] });
    }
  }, 0.036, NOSTEEL), tint, low));
  const hookAnchor = new THREE.Object3D();
  hookAnchor.position.set(0.133, -0.003, 0);
  boom.add(hookAnchor);
  // трос: два параллельных, высота 1, центр в нуле — соглашение Site сохраняется
  const ropeGeo = part("crn:rope", (pb) => { for (const z of [-0.0012, 0.0012]) pb.add(gCyl(0.00045, 0.00045, 1, 5), "rope", { p: [0, 0, z] }, "#ffffff", { dirt: false }); });
  const rope = new THREE.Mesh(ropeGeo.rope, mats().rope);
  g.add(rope);
  // груз: подвеска с крюком, 4 стропа, плита или пачка арматуры; начало координат — верх подвески
  const rebar = Math.random() < 0.4;
  const load = inst(part(`crn:load:${rebar}`, (pb) => {
    pb.add(gBox(0.004, 0.005, 0.0032), "paint", { p: [0, -0.0025, 0] }, "#f2c200");
    pb.add(new THREE.TorusGeometry(0.0012, 0.0004, 5, 10, Math.PI * 1.4), "steel", { p: [0, -0.0062, 0] }, "#888");
    const cy = -0.0125;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rodBetween(pb, V(0, -0.0068, 0), V(sx * 0.0065, cy + 0.002, sz * 0.0045), 0.00025, "dark", "#222", 4);
    if (rebar) for (let i = 0; i < 12; i++) pb.add(gCyl(0.0004, 0.0004, 0.018, 5), "steel", { p: [0, cy + (i % 3) * 0.0008, -0.0025 + (i / 3 | 0) * 0.0017], r: [0, 0, Math.PI / 2] }, "#7a5a44", { dirt: false });
    else pb.add(gBox(0.016, 0.004, 0.012), "concrete", { p: [0, cy, 0] }, "#a7a59e", { dirt: false });
  }, 0, NOSTEEL), tint, low);
  g.add(load);
  blobShadow(g, 0.05, 0.034);
  g.userData.parts = { turret, boom, hookAnchor, rope, load };
  g.userData.top = 0.13;
  g.userData.update = (dt, T, mc) => { bc.visible = mc.state !== "work" && ((T * 4) | 0) % 2 === 0; };
  return g;
}

// ---------------------------------------------------------------------------
// Самосвал (КамАЗ-6520-подобный)
// ---------------------------------------------------------------------------
function makeTruck(tint, detail = "high") {
  const low = detail === "low";
  const g = new THREE.Group();
  g.add(inst(part(`trk:${detail}:chassis`, (pb) => {
    pb.add(gBox(0.064, 0.004, 0.014), "dark", { p: [-0.002, 0.0095, 0] }, "#262626");
    truckCab(pb, { x: 0.023, low });
    pb.add(gBox(0.009, 0.004, 0.003), "steel", { p: [0.008, 0.009, -0.0105] }, "#9c9c98");                  // бак
    pb.add(gCyl(0.0008, 0.0008, 0.016, 8), "dark", { p: [0.0145, 0.022, 0.0095] }, "#222");                // выхлоп за кабиной
    for (const x of [0.022, -0.019]) for (const z of [-0.0108, 0.0108]) pb.add(gBox(x > 0 ? 0.015 : 0.024, 0.0008, 0.0072), "dark", { p: [x, 0.0142, z] }, "#2a2a2a");
    for (const z of [-0.0125, 0.0125]) pb.add(gBox(0.0004, 0.005, 0.006), "dark", { p: [-0.031, 0.0085, z] }, "#151515");   // брызговики
    if (!low) pb.add(gDecal(0.012, 0.0028, ATLAS.zebra), "decal", { p: [-0.0341, 0.009, 0], r: [0, -Math.PI / 2, 0] });
    // «Два мира»: колёса статичные, слиты с шасси (меньше вызовов отрисовки)
    if (low) for (const [x, dual] of [[0.022, false], [-0.014, true], [-0.024, true]]) for (const z of [-0.0105, 0.0105]) wheel(pb, { x, y: 0.0065, z: z * (dual ? 0.92 : 1), r: 0.0065, w: 0.0045, dual, detail });
  }, 0, NOSTEEL), tint, low));
  // оси с колёсами — вращаются по пройденному пути
  const axles = [];
  if (!low) for (const [x, dual] of [[0.022, false], [-0.014, true], [-0.024, true]]) {
    const ax = inst(part(`trk:${detail}:axle:${dual}`, (pb) => {
      for (const z of [-0.0105, 0.0105]) wheel(pb, { x: 0, y: 0, z: z * (dual ? 0.92 : 1), r: 0.0065, w: 0.0045, dual, detail });
    }, 0.0065), tint, low);
    ax.position.set(x, 0.0065, 0);
    g.add(ax);
    axles.push(ax);
  }
  // кузов: шарнир на заднем краю, смотрит вперёд по +x
  const bed = new THREE.Group();
  bed.position.set(-0.026, 0.016, 0);
  g.add(bed);
  bed.add(inst(part(`trk:${detail}:bed`, (pb) => {
    pb.add(gBox(0.042, 0.0015, 0.024), "paint", { p: [0.021, 0.0008, 0] });
    for (const s of [-1, 1]) {
      pb.add(gBox(0.042, 0.0105, 0.0012), "paint", { p: [0.021, 0.006, s * 0.0118] });
      pb.add(gBox(0.042, 0.0012, 0.0016), "paint", { p: [0.021, 0.0114, s * 0.0118] });                 // обвязка
      if (!low) for (let i = 0; i < 5; i++) pb.add(gBox(0.0008, 0.0095, 0.0006), "paint", { p: [0.004 + i * 0.0085, 0.0058, s * 0.0127] });   // рёбра
    }
    pb.add(gBox(0.0012, 0.0125, 0.024), "paint", { p: [0.0414, 0.0068, 0] });
    pb.add(gBox(0.0012, 0.0105, 0.024), "paint", { p: [0.0006, 0.0058, 0] });
    pb.add(gBox(0.0085, 0.0012, 0.0245), "paint", { p: [0.0465, 0.0128, 0] });                          // козырёк над кабиной
    const soil = new THREE.IcosahedronGeometry(1, 1);
    const sp = soil.attributes.position;
    for (let i = 0; i < sp.count; i++) { const k = 1 + 0.25 * (hash(sp.getX(i), sp.getY(i), sp.getZ(i)) - 0.5); sp.setXYZ(i, sp.getX(i) * k, sp.getY(i) * k, sp.getZ(i) * k); }
    soil.computeVertexNormals();
    pb.add(soil, "dark", { p: [0.021, 0.0085, 0], s: [0.019, 0.0055, 0.0105] }, "#6b4a2b", { dirt: false });
  }, 0.016), tint, low));
  const hazard = inst(part("trk:hazard", (pb) => {
    for (const z of [-0.0105, 0.0105]) {
      pb.add(gBox(0.0008, 0.0012, 0.002), "beacon", { p: [0.0302, 0.0145, z] }, "#ffffff", { dirt: false });
      pb.add(gBox(0.0006, 0.0012, 0.002), "beacon", { p: [-0.0346, 0.011, z] }, "#ffffff", { dirt: false });
    }
  }), tint);
  hazard.visible = false;
  g.add(hazard);
  const ram = low ? null : makeRam(g, V(0.004, 0.0095, 0), bed, V(0.034, -0.001, 0), { barrel: 0.006, rod: 0.006, rB: 0.0013, rR: 0.0008, stages: 3, tint: "#3b3a36" });
  blobShadow(g, 0.045, 0.024);
  g.userData.parts = { bed, axles };
  g.userData.top = 0.06;
  const last = new THREE.Vector3(NaN);
  g.userData.update = (dt, T, mc) => {
    if (!Number.isNaN(last.x) && dt > 0) {
      const ds = last.distanceTo(g.position);
      for (const a of axles) a.rotation.z -= ds / 0.0065;
    }
    last.copy(g.position);
    hazard.visible = mc.state !== "work" && ((T * 3) | 0) % 2 === 0;
    ram?.();
  };
  return g;
}

const MAKERS = { excavator: makeExcavator, bulldozer: makeBulldozer, crane: makeCrane, truck: makeTruck };

// ---------------------------------------------------------------------------
// Рабочие: сегменты тела, ходьба без «скольжения», поза ремонта, жесты
// ---------------------------------------------------------------------------
const PEOPLE = {
  6: { suit: "#2f3a4a", helmet: "#e9e6dc", vest: true, tash: true },
  3: { suit: "#4a4f3a", helmet: "#e36b12", vest: true },
  boss: { suit: "#a3262a", pants: "#2b2b30", helmet: "#e9e6dc", vest: false, noWrench: true },
};
const SKIN = "#c99a7a", GLOVE = "#3b3a35", BOOT = "#2a2420", HIVIS = "#e8661c", REFL = "#c9cfd3";
const BASE_Y = 0.0145;

function seg(key, build) {
  return new THREE.Mesh(part("ppl:" + key, (pb) => build(pb)).figure, mats().figure);
}

export function makeWorker(grade) {
  const c = PEOPLE[grade] || PEOPLE[6];
  const g = new THREE.Group();
  const body = new THREE.Group();          // таз: от него ноги и торс
  body.position.y = BASE_Y;
  g.add(body);
  const legs = {}, arms = {};
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0, -0.0004, side * 0.0021);
    body.add(leg);
    leg.add(seg(`thigh:${grade}`, (pb) => pb.add(gCyl(0.0016, 0.0014, 0.0068, 8), "figure", { p: [0, -0.0034, 0] }, c.pants || c.suit, { dirt: false })));
    const shin = new THREE.Group();
    shin.position.y = -0.0068;
    leg.add(shin);
    shin.add(seg(`shin:${grade}`, (pb) => {
      pb.add(gCyl(0.0014, 0.0012, 0.0062, 8), "figure", { p: [0, -0.0031, 0] }, c.pants || c.suit, { dirt: false });
      pb.add(gBox(0.0042, 0.0016, 0.0026), "figure", { p: [0.0008, -0.0068, 0] }, BOOT, { dirt: false });
    }));
    legs[side] = { leg, shin };
  }
  const torso = new THREE.Group();
  body.add(torso);
  torso.add(seg(`torso:${grade}`, (pb) => {
    pb.add(gBox(0.0034, 0.0088, 0.0064), "figure", { p: [0, 0.0046, 0] }, c.suit, { dirt: false });
    if (c.vest) {
      pb.add(gBox(0.0037, 0.0058, 0.0066), "figure", { p: [0, 0.0055, 0] }, HIVIS, { dirt: false });
      for (const y of [0.0038, 0.0062]) pb.add(gBox(0.0038, 0.0005, 0.0067), "figure", { p: [0, y, 0] }, REFL, { dirt: false });
    }
    pb.add(gBox(0.0036, 0.0011, 0.0066), "figure", { p: [0, 0.0004, 0] }, "#1d1d1d", { dirt: false });   // ремень
    pb.add(gCyl(0.0009, 0.001, 0.0016, 8), "figure", { p: [0, 0.0096, 0] }, SKIN, { dirt: false });       // шея
  }));
  const head = new THREE.Group();
  head.position.y = 0.0102;
  torso.add(head);
  head.add(seg(`head:${grade}`, (pb) => {
    pb.add(new THREE.SphereGeometry(0.0021, 12, 9), "figure", { p: [0, 0.0024, 0], s: [1, 1.15, 0.95] }, SKIN, { dirt: false });
    pb.add(gBox(0.0008, 0.0009, 0.0006), "figure", { p: [0.0021, 0.0022, 0] }, SKIN, { dirt: false });     // нос
    if (c.tash) pb.add(gBox(0.0004, 0.0004, 0.0018), "figure", { p: [0.0021, 0.0014, 0] }, "#4a3a2e", { dirt: false });
    for (const z of [-0.0008, 0.0008]) pb.add(gBox(0.0002, 0.0003, 0.0003), "figure", { p: [0.002, 0.0028, z] }, "#1a1a1a", { dirt: false });
  }));
  const helmet = seg(`helmet:${grade}`, (pb) => {
    pb.add(new THREE.SphereGeometry(0.0026, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), "figure", {}, c.helmet, { dirt: false });
    pb.add(gCyl(0.0031, 0.0031, 0.0003, 14), "figure", { p: [0.0004, 0, 0] }, c.helmet, { dirt: false });
    pb.add(gBox(0.0042, 0.0006, 0.0008), "figure", { p: [0, 0.0024, 0] }, c.helmet, { dirt: false });
  });
  helmet.position.set(0, 0.0036, 0);
  head.add(helmet);
  helmet.userData.home = { p: helmet.position.clone(), q: helmet.quaternion.clone() };
  let wrench = new THREE.Object3D();
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0.0084, side * 0.0041);
    torso.add(arm);
    arm.add(seg(`upper:${grade}`, (pb) => pb.add(gCyl(0.0012, 0.0011, 0.0056, 8), "figure", { p: [0, -0.0028, 0] }, c.suit, { dirt: false })));
    const fore = new THREE.Group();
    fore.position.y = -0.0056;
    arm.add(fore);
    fore.add(seg(`fore:${grade}`, (pb) => {
      pb.add(gCyl(0.0011, 0.001, 0.0052, 8), "figure", { p: [0, -0.0026, 0] }, c.suit, { dirt: false });
      pb.add(gBox(0.0016, 0.0018, 0.0014), "figure", { p: [0.0002, -0.006, 0] }, GLOVE, { dirt: false });
    }));
    if (side === 1 && !c.noWrench) {
      wrench = seg("wrench", (pb) => {
        pb.add(gBox(0.0006, 0.0062, 0.0004), "figure", { p: [0, -0.002, 0] }, "#8c8d8a", { dirt: false });
        pb.add(gBox(0.0016, 0.0012, 0.0004), "figure", { p: [0, -0.0052, 0] }, "#8c8d8a", { dirt: false });
      });
      wrench.position.set(0.0006, -0.006, 0);
      wrench.rotation.z = wrench.userData.baseZ = Math.PI / 2;
      fore.add(wrench);
    }
    arms[side] = { arm, fore };
  }
  blobShadow(g, 0.0075, 0.0075);
  g.userData.parts = { body, wrench, torso, head, helmet, legs, arms };
  g.userData.badgeY = 0.045;

  // --- анимация: сначала сброс, потом ходьба / работа / ожидание, потом жест ---
  let ph = 0, workMode = Math.random() < 0.5 ? "hammer" : "wrench", wasWorking = false, look = 0, lookT = 2, lookTo = 0;
  let gest = null;
  const L = legs[-1], R = legs[1], AL = arms[-1], AR = arms[1];
  g.userData.update = (dt, T, st = {}) => {
    for (const j of [L.leg, L.shin, R.leg, R.shin, AL.arm, AL.fore, AR.arm, AR.fore, torso, head]) j.rotation.set(0, 0, 0);
    torso.scale.y = 1;
    body.position.set(0, BASE_Y, 0);
    if (st.moving) {
      ph += dt * 9 * Math.max(1, (st.walk || 0.5) / 0.5);
      const s = Math.sin(ph);
      L.leg.rotation.z = s * 0.5; R.leg.rotation.z = -s * 0.5;
      L.shin.rotation.z = -Math.max(0, -s) * 0.8; R.shin.rotation.z = -Math.max(0, s) * 0.8;
      AL.arm.rotation.z = -s * 0.4; AR.arm.rotation.z = s * 0.4;
      AL.fore.rotation.z = AR.fore.rotation.z = 0.3;
      body.position.y = BASE_Y + Math.abs(Math.cos(ph)) * 0.0007;
    } else if (st.working) {
      if (!wasWorking) workMode = Math.random() < 0.5 ? "hammer" : "wrench";
      torso.rotation.z = -0.35;
      L.leg.rotation.z = 0.25; L.shin.rotation.z = -0.3;
      if (workMode === "hammer") { AR.arm.rotation.z = 1.2 + Math.sin(T * 3 * Math.PI * 2) * 0.55; AR.fore.rotation.z = 0.4; }
      else { AR.arm.rotation.z = 1.0 + Math.sin(T * 8 * Math.PI * 2) * 0.2; AR.fore.rotation.z = 0.9; wrench.rotation.x = Math.sin(T * 8 * Math.PI * 2) * 0.4; }
      AL.arm.rotation.z = 0.9; AL.fore.rotation.z = 0.7;
    } else {
      torso.scale.y = 1 + Math.sin(T * 1.6) * 0.01;            // дыхание
      if ((lookT -= dt) <= 0) { lookT = 3 + Math.random() * 3; lookTo = (Math.random() * 2 - 1) * 0.4; }
      look = lerp(look, lookTo, Math.min(1, dt * 3));
      head.rotation.y = look;
      AL.arm.rotation.x = -0.08; AR.arm.rotation.x = 0.08;
    }
    wasWorking = !!st.working;
    if (gest) applyGesture(dt);
  };

  // жесты: процедурные позы, огибающая sin(πk)
  const DUR = { shock: 0.8, shrug: 0.9, angry: 1.2, throwHelmet: 1.4, waveOff: 1, wave: 1.5, facepalm: 1.2, highFive: 0.8, pickUp: 1.2, cheer: 1, sad: 1.6 };
  function applyGesture(dt) {
    gest.t += dt;
    const k = Math.min(1, gest.t / gest.dur), s = Math.sin(Math.PI * k), t = gest.t;
    switch (gest.name) {
      case "shock": AL.arm.rotation.z = AR.arm.rotation.z = 2.5 * s; AL.arm.rotation.x = -0.4 * s; AR.arm.rotation.x = 0.4 * s; body.position.x = -0.002 * s; break;
      case "shrug": AL.arm.rotation.x = -0.6 * s; AR.arm.rotation.x = 0.6 * s; AL.fore.rotation.z = AR.fore.rotation.z = 1.2 * s; head.rotation.x = 0.25 * s; break;
      case "angry": AR.arm.rotation.z = 2.6 * s + Math.sin(t * 22) * 0.25 * s; AR.fore.rotation.z = 0.4 * s; torso.rotation.z = -0.1 * s; break;
      case "throwHelmet": {
        AR.arm.rotation.z = k < 0.4 ? 3.0 * (k / 0.4) : 3.0 - 2.4 * Math.min(1, (k - 0.4) / 0.3);
        torso.rotation.z = k < 0.4 ? 0.15 * (k / 0.4) : -0.3 * s;
        if (!gest.thrown && t >= 0.55) { gest.thrown = true; throwHelmet(gest.ctx?.site); }
        break;
      }
      case "waveOff": AR.arm.rotation.z = 1.2 * s; AR.arm.rotation.x = Math.sin(t * 8) * 0.5 * s; AR.fore.rotation.z = 0.3 * s; head.rotation.y = -0.4 * s; break;
      case "wave": AR.arm.rotation.z = 2.7 * s; AR.arm.rotation.x = 0.3 * s; AR.fore.rotation.x = Math.sin(t * 10) * 0.5 * s; break;
      case "facepalm": AR.arm.rotation.z = 1.6 * s; AR.fore.rotation.z = 2.1 * s; head.rotation.z = -0.2 * s; break;
      case "highFive": AR.arm.rotation.z = 2.4 * s; AR.fore.rotation.z = 0.2 * s; break;
      case "cheer": AL.arm.rotation.z = AR.arm.rotation.z = 2.8 * s; body.position.y += Math.abs(Math.sin(t * 10)) * 0.003 * s; break;
      case "sad": head.rotation.z = -0.4 * s; torso.rotation.z = -0.15 * s; break;
      case "pickUp": {
        L.leg.rotation.z = R.leg.rotation.z = 1.2 * s; L.shin.rotation.z = R.shin.rotation.z = -1.9 * s;
        body.position.y = BASE_Y - 0.0045 * s; torso.rotation.z = -0.5 * s; AR.arm.rotation.z = 0.9 * s;
        if (!gest.picked && k >= 0.5) { gest.picked = true; pickHelmet(gest.ctx?.site); }
        break;
      }
    }
    if (k >= 1) { const r = gest.res; gest = null; r(); }
  }

  // бросок каски: дальше баллистика в системе площадки, один отскок, лежит на боку
  function throwHelmet(site) {
    if (!site || helmet.parent !== head) return;
    site.group.attach(helmet);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    const st = { v: fwd.multiplyScalar(0.06).add(new THREE.Vector3(0, 0.14, 0)), bounced: false, rest: false };
    helmet.userData.fly = (dt) => {
      if (st.rest) return;
      st.v.y -= 0.6 * dt;
      helmet.position.addScaledVector(st.v, dt);
      helmet.rotation.x += 8 * dt; helmet.rotation.z += 5 * dt;
      if (helmet.position.y <= 0.0025 && st.v.y < 0) {
        helmet.position.y = 0.0025;
        if (!st.bounced) { st.bounced = true; st.v.y *= -0.3; st.v.x *= 0.4; st.v.z *= 0.4; }
        else { st.rest = true; helmet.rotation.set(Math.PI / 2, helmet.rotation.y, 0); helmet.position.y = 0.0028; }
      }
    };
    site.droppedHelmet = helmet;
    (site.flying ||= new Set()).add(helmet);
  }
  function pickHelmet(site) {
    const h = site?.droppedHelmet;
    if (!h) return;
    site.flying?.delete(h);
    if (h === helmet) {
      head.attach(h);
      h.position.copy(h.userData.home.p);
      h.quaternion.copy(h.userData.home.q);
    } else {                                   // вернулся «новый» 3-й: чужую (свою же, брошенную) каску — на голову
      h.removeFromParent();
      helmet.visible = true;
    }
    site.droppedHelmet = null;
  }

  g.userData.gesture = (name, ctx = {}) => new Promise((res) => {
    if (gest) gest.res();
    gest = { name, t: 0, dur: DUR[name] || 1, res, ctx };
  });
  // если уходит без каски — каска остаётся лежать на площадке (её освободит сама площадка)
  return g;
}

// ---------------------------------------------------------------------------
// Значки, окружение, свет
// ---------------------------------------------------------------------------
let ICONS = null;
function icons() {
  if (ICONS) return ICONS;
  const tex = (draw) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    draw(c.getContext("2d"));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.SpriteMaterial({ map: t, depthTest: false });
  };
  ICONS = {
    wait: tex((x) => {
      x.fillStyle = "rgba(0,0,0,0.3)"; x.beginPath(); x.moveTo(66, 12); x.lineTo(124, 116); x.lineTo(8, 116); x.fill();
      x.fillStyle = "#f2c200"; x.strokeStyle = "#1a1a1a"; x.lineWidth = 7; x.lineJoin = "round";
      x.beginPath(); x.moveTo(64, 8); x.lineTo(120, 110); x.lineTo(8, 110); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = "#1a1a1a"; x.font = "bold 64px Arial"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("!", 64, 76);
    }),
    fix: tex((x) => {
      x.fillStyle = "#202327"; x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fill();
      x.lineWidth = 6; x.strokeStyle = "#f2c200"; x.stroke();
      x.fillStyle = "#f2c200"; x.font = "bold 66px Arial"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("⚒", 64, 70);
    }),
  };
  return ICONS;
}

function decor(site, layout, detail) {
  const z = layout.zones;
  const low = detail === "low";
  // корпус: перекрытия с колоннами, видимость этажей как раньше
  const [bx, by] = z.building.center;
  const [bw, bd] = z.building.size;
  site.building = new THREE.Group();
  site.building.position.copy(P(bx, by));
  site.group.add(site.building);
  const floorGeo = part(`floor:${bw}:${bd}`, (pb) => {
    pb.add(gBox(bw * 0.98, 0.0024, bd * 0.98), "concrete", { p: [0, 0.0083, 0] }, "#9b9a94", { dirt: false });
    pb.add(gBox(bw * 0.985, 0.0008, bd * 0.985), "concrete", { p: [0, 0.0093, 0] }, "#b4b3ad", { dirt: false });   // кант
    const nx = 5, nz = 4;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
      pb.add(gBox(0.0028, 0.0072, 0.0028), "concrete", { p: [(-0.5 + (i + 0.5) / nx) * bw * 0.92, 0.0036, (-0.5 + (j + 0.5) / nz) * bd * 0.92] }, "#8d8c86", { dirt: false });
    }
  });
  site.floors = [];
  for (let i = 0; i < 10; i++) {
    const f = new THREE.Mesh(floorGeo.concrete, mats().concrete);
    f.position.y = i * 0.0095;
    f.visible = i === 0;
    site.building.add(f);
    site.floors.push(f);
  }
  // бытовка: контейнер с гофрой, дверь, окно с решёткой, ступени, баллон, верстак
  const tr = new THREE.Group();
  tr.position.copy(P(...z.trailer));
  site.group.add(tr);
  tr.add(inst(part(`trailer:${detail}`, (pb) => {
    pb.add(gBox(0.085, 0.04, 0.05), "paint", { p: [0, 0.02, 0] });
    if (!low) for (let i = 0; i < 28; i++) for (const s of [-1, 1]) pb.add(gBox(0.0012, 0.038, 0.0008), "paint", { p: [-0.041 + i * 0.003, 0.02, s * 0.0253] });
    pb.add(gBox(0.087, 0.0016, 0.052), "paint", { p: [0, 0.0405, 0] }, "#d0d4d6");
    pb.add(gBox(0.012, 0.026, 0.0012), "paint", { p: [0.032, 0.015, 0.0258] }, "#3b4650");          // дверь
    for (const x of [-0.025, 0.008]) {
      pb.add(gBox(0.016, 0.012, 0.0008), low ? "dark" : "glass", { p: [x, 0.025, 0.0258] }, low ? "#1d2a31" : "#ffffff", { dirt: false });
      if (!low) for (let k = 0; k < 4; k++) pb.add(gBox(0.0006, 0.012, 0.0006), "steel", { p: [x - 0.006 + k * 0.004, 0.025, 0.0265] }, "#555");
    }
    pb.add(gBox(0.016, 0.003, 0.008), "dark", { p: [0.032, 0.0015, 0.03] }, "#7a6248");               // поддон-ступень
    pb.add(gCyl(0.0028, 0.0028, 0.014, 10), "paint", { p: [0.045, 0.007, -0.01] }, "#c0281e");         // баллон
    pb.add(gBox(0.018, 0.0016, 0.007), "dark", { p: [-0.02, 0.0095, 0.031] }, "#6b5440");              // верстак
    for (const x of [-0.028, -0.012]) pb.add(gBox(0.0012, 0.009, 0.0012), "dark", { p: [x, 0.0045, 0.031] }, "#333");
    pb.add(gBox(0.004, 0.004, 0.003), "steel", { p: [-0.023, 0.0123, 0.031] }, "#c0281e");
  }), "#5f7380", low));
  blobShadow(tr, 0.06, 0.04);
  const sign = labelSprite("РЕМОНТ", "#2f3a4a");
  sign.position.set(0, 0.07, 0);
  sign.scale.multiplyScalar(0.8);
  tr.add(sign);
  site.own.push(sign.material.map, sign.material);
  site.trailerPos = tr.position.clone().add(new THREE.Vector3(0.032, 0, 0.036));
  site.trailerTop = tr.position.clone().add(new THREE.Vector3(0, 0.085, 0));
  // деревья: ствол и три «облака», все деревья площадки — одним мешем на материал
  const trees = part(`trees:${z.trees.length}`, (pb) => {
    for (const [mx, my] of z.trees) {
      const s = 0.8 + (((mx * 97 + my * 31) % 1) + 1) % 1 * 0.6;
      const p = P(mx, my);
      pb.add(gCyl(0.0016 * s, 0.0024 * s, 0.016 * s, 7), "dark", { p: [p.x, 0.008 * s, p.z] }, "#4b3826", { dirt: false });
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + mx * 10;
        pb.add(new THREE.IcosahedronGeometry(0.008 * s, 0), "foliage", { p: [p.x + Math.cos(a) * 0.004 * s, (0.02 + k * 0.004) * s, p.z + Math.sin(a) * 0.004 * s], r: [a, a * 0.7, 0] }, k % 2 ? "#3e5a2e" : "#4c6b35", { dirt: false });
      }
    }
  });
  site.group.add(inst(trees, "#ffffff"));
  // прораб у двери бытовки
  const boss = makeWorker("boss");
  boss.position.copy(site.trailerPos).add(new THREE.Vector3(0.012, 0, 0.012));
  boss.rotation.y = -Math.PI / 4;
  site.group.add(boss);
  site.boss = boss;
  site.decorUpdate = (dt, T) => {
    boss.userData.update(dt, T, {});
    if (site.flying) for (const h of site.flying) h.userData.fly?.(dt);
  };
}

const pmrem = new WeakMap();
const env = {
  sky: "#aeb8bf",
  ground: "#6e6453",
  // свет и окружение: металл без окружения выглядит чёрным
  setupLights(scene, renderer) {
    const rig = new THREE.Group();
    rig.add(new THREE.HemisphereLight("#cfd8e0", "#5a4a3a", 1.0));
    const sun = new THREE.DirectionalLight("#fff1dc", 2.2);
    sun.position.set(-0.7, 0.8, 0.6);
    rig.add(sun);
    if (!pmrem.has(renderer)) {
      const gen = new THREE.PMREMGenerator(renderer);
      pmrem.set(renderer, gen.fromScene(new RoomEnvironment(renderer), 0.04).texture);
      gen.dispose();
    }
    scene.environment = pmrem.get(renderer);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    return rig;
  },
};

export const kit = {
  id: "adult",
  tints: {
    excavator: ["#c9a227", "#b8902a", "#c27a2c"],
    bulldozer: ["#b98a2e", "#9c7b3c", "#6b6b3a"],
    crane: ["#d08a2b", "#b5432f", "#c7c2b5"],
    truck: ["#c8642a", "#4f6273", "#5b6a3c"],
  },
  makeMachine: (kind, tint, detail) => MAKERS[kind](tint, detail),
  makeWorker: (g) => makeWorker(g),
  icons,
  badge: { 6: "#2f3a4a", 3: "#55603a" },
  smokeColor: "#3a3a3a",
  decor,
  env,
};
