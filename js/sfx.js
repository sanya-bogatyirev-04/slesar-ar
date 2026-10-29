// Рецепты звуков. Один и тот же id в обеих версиях — режиссёру не нужно знать версию.
//  TOY   — обычная версия: лёгкий «игрушечный» синтез (бдыщ, тук-тук, джингл);
//  REAL  — «Для опытных»: слои реальных записей из assets/sfx (CC0, Freesound; см. CREDITS.md);
//  SYNTH — синтез, который остаётся и в режиме «Для опытных» (клаксон, шаги, щелчок интерфейса).
// Рецепт: (engine, out, { delay, kind }) → длительность в секундах (0 — не прозвучал).

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Кирпичики синтеза
// ---------------------------------------------------------------------------
function tone(e, out, { type = "sine", f, f1 = 0, t, dur, a = 0.005, peak = 0.3, glide = 0, vib = 0, vibDepth = 0, filter = null }) {
  const c = e.ctx;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + (glide || dur));
  if (vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = vib; lg.gain.value = vibDepth;
    l.connect(lg).connect(o.frequency);
    l.start(t); l.stop(t + dur + 0.05);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  let node = o;
  if (filter) { const bq = c.createBiquadFilter(); Object.assign(bq, { type: filter.type }); bq.frequency.value = filter.f; bq.Q.value = filter.q || 1; node.connect(bq); node = bq; }
  node.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
  return g;
}

function noise(e, out, { kind = "white", t, dur, a = 0.003, peak = 0.3, type = "lowpass", f = 1000, f1 = 0, q = 0.7 }) {
  const c = e.ctx;
  const s = c.createBufferSource();
  s.buffer = e.noise[kind];
  s.loop = true;
  const bq = c.createBiquadFilter();
  bq.type = type; bq.Q.value = q;
  bq.frequency.setValueAtTime(f, t);
  if (f1) bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(bq).connect(g).connect(out);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}

const T0 = (e, o) => e.ctx.currentTime + (o.delay || 0);

// ---------------------------------------------------------------------------
// TOY — обычная версия
// ---------------------------------------------------------------------------
const BREAK_F0 = { excavator: 520, bulldozer: 420, crane: 640, truck: 700 };
const HIT_K = { excavator: 1, bulldozer: 0.85, crane: 1.15, truck: 1.05 };

function toyBreak(kind) {
  return (e, out, o) => {
    const t = T0(e, o), f0 = BREAK_F0[kind] * rnd(0.94, 1.06);
    tone(e, out, { f: f0, f1: f0 / 5, glide: 0.25, t, dur: 0.32, peak: 0.45 });                       // «бдыщ»
    noise(e, out, { t, dur: 0.25, peak: 0.4, f: 1200, f1: 300 });                                      // удар
    noise(e, out, { kind: "pink", t: t + 0.08, dur: 0.45, a: 0.05, peak: 0.22, type: "bandpass", f: 800, q: 1 });   // «пуф» дыма
    if (kind === "crane") tone(e, out, { f: 220, f1: 150, t: t + 0.15, dur: 0.55, peak: 0.25, vib: 7, vibDepth: 30 });   // «бойнг»
    return 0.75;
  };
}

function toyHit(k = 1) {
  return (e, out, o) => {
    const t = T0(e, o), m = (HIT_K[o.kind] || 1) * k * rnd(0.96, 1.04);
    tone(e, out, { f: 1500 * m, t, dur: 0.07, a: 0.002, peak: 0.22 });
    tone(e, out, { f: 2210 * m, t, dur: 0.06, a: 0.002, peak: 0.12 });
    noise(e, out, { t, dur: 0.012, a: 0.001, peak: 0.15, type: "highpass", f: 3000 });
    return 0.1;
  };
}

export const TOY = {
  "break.excavator": toyBreak("excavator"),
  "break.bulldozer": toyBreak("bulldozer"),
  "break.crane": toyBreak("crane"),
  "break.truck": toyBreak("truck"),
  "repair.start": toyHit(0.8),
  "repair.hit": toyHit(1),
  "repair.ratchet": toyHit(1.2),
  "repair.grinder": toyHit(0.9),
  "repair.impact": toyHit(1.1),
  "fix.done": (e, out, o) => {
    const t = T0(e, o);
    [523, 659, 784, 1047].forEach((f, i) => tone(e, out, { type: "triangle", f, t: t + i * 0.07, dur: 0.16, peak: 0.18 }));
    tone(e, out, { f: 2093, t: t + 0.3, dur: 0.3, peak: 0.06 });
    tone(e, out, { f: 2637, t: t + 0.36, dur: 0.3, peak: 0.05 });
    return 0.7;
  },
  "wait.nag": (e, out, o) => {
    const t = T0(e, o);
    tone(e, out, { type: "triangle", f: 440, t, dur: 0.18, a: 0.02, peak: 0.16 });
    tone(e, out, { type: "triangle", f: 392, t: t + 0.2, dur: 0.2, a: 0.02, peak: 0.16 });
    return 0.45;
  },
  "scene.fire": (e, out, o) => {                    // «грустный тромбон»
    const t = T0(e, o), flt = { type: "lowpass", f: 1000, q: 2 };
    [392, 370, 349].forEach((f, i) => tone(e, out, { type: "sawtooth", f, t: t + i * 0.36, dur: 0.34, a: 0.03, peak: 0.12, filter: flt }));
    tone(e, out, { type: "sawtooth", f: 330, t: t + 1.08, dur: 1.0, a: 0.03, peak: 0.12, vib: 5, vibDepth: 6, filter: flt });
    return 2.1;
  },
  "scene.return": (e, out, o) => {                  // фанфара
    const t = T0(e, o), flt = { type: "lowpass", f: 2500 };
    [523, 659, 784].forEach((f, i) => tone(e, out, { type: "square", f, t: t + i * 0.12, dur: 0.12, a: 0.01, peak: 0.07, filter: flt }));
    tone(e, out, { type: "square", f: 1047, t: t + 0.36, dur: 0.45, a: 0.01, peak: 0.07, filter: flt });
    tone(e, out, { type: "triangle", f: 262, t, dur: 0.8, peak: 0.12 });
    return 0.85;
  },
  "helmet.drop": (e, out, o) => {
    const t = T0(e, o);
    tone(e, out, { f: 640, f1: 320, t, dur: 0.1, a: 0.002, peak: 0.18 });
    tone(e, out, { f: 560, f1: 300, t: t + 0.2, dur: 0.08, a: 0.002, peak: 0.1 });
    return 0.35;
  },
  "ui.click": (e, out, o) => { const t = T0(e, o); tone(e, out, { f: 1100, f1: 700, t, dur: 0.04, a: 0.002, peak: 0.12 }); return 0.05; },
  "steps": (e, out, o) => { const t = T0(e, o); noise(e, out, { t, dur: 0.05, a: 0.005, peak: 0.08, f: 600 }); return 0.06; },
};

// живой фон обычной версии: тихий гул + розовый шум + изредка «птичка»
export function startToyAmbient(e, bus) {
  const c = e.ctx;
  const gain = c.createGain();
  gain.connect(bus);
  const hum = c.createGain();
  hum.gain.value = 1;
  hum.connect(gain);
  for (const f of [98, 147]) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = f; g.gain.value = 0.012;
    o.connect(g).connect(hum); o.start();
  }
  const lfo = c.createOscillator(), lg = c.createGain();
  lfo.frequency.value = 0.15; lg.gain.value = 0.3;
  lfo.connect(lg).connect(hum.gain); lfo.start();
  const n = c.createBufferSource(), nf = c.createBiquadFilter(), ng = c.createGain();
  n.buffer = e.noise.pink; n.loop = true;
  nf.type = "lowpass"; nf.frequency.value = 500; ng.gain.value = 0.015;
  n.connect(nf).connect(ng).connect(gain); n.start();
  const bird = () => {
    if (c.state === "running" && gain.gain.value > 0.01) {
      const t = c.currentTime;
      for (let i = 0; i < 3; i++) tone(e, gain, { f: 3000, f1: 4500, glide: 0.08, t: t + i * 0.12, dur: 0.09, peak: 0.02 });
    }
    setTimeout(bird, rnd(8000, 15000));
  };
  setTimeout(bird, rnd(4000, 9000));
  return { gain };
}

// ---------------------------------------------------------------------------
// Реальные записи («Для опытных»). Нарезка: onsets — по ударам, pauses — по паузам
// ---------------------------------------------------------------------------
export const SFX_FILES = {
  amb_site: {}, amb_excavator: {}, amb_diesel: {}, beep_reverse: {},
  break_crash: { slice: "onsets", maxLen: 2.5, minLen: 0.3 },
  break_clank: {}, break_pipe: {}, break_backfire: {}, break_hiss: {},
  break_stall: { slice: "pauses", gap: 0.4, maxLen: 4 },
  fix_hammer: { slice: "onsets", maxLen: 0.9 },
  fix_ratchet: {}, fix_grinder: {}, fix_clank: {},
  start_tractor: { region: [0, 6] }, start_engine: {},
};
// порядок загрузки: фон → поломки → ремонт и запуск → писк → длинные фоны
export const SFX_ORDER = ["amb_site", "break_hiss", "break_pipe", "break_crash", "break_clank", "break_stall", "break_backfire",
  "fix_clank", "fix_hammer", "fix_ratchet", "fix_grinder", "start_tractor", "start_engine", "beep_reverse", "amb_excavator", "amb_diesel"];

// слои: [файл, опции]; рецепт молчит (0), если главный слой ещё не загружен
function layers(...ls) {
  return (e, out, o) => {
    const b = e.bank;
    if (!b || !b.ready(ls[0][0])) return 0;
    let dur = 0;
    for (const [name, opt = {}, p = 1] of ls) {
      if (Math.random() > p) continue;
      dur = Math.max(dur, b.play(name, out, { ...opt, delay: (o.delay || 0) + (opt.delay || 0) }));
    }
    return dur;
  };
}

export const REAL = {
  "break.excavator": layers(["break_hiss", { gain: 0.7 }], ["break_pipe", { gain: 0.6, delay: 0.05 }], ["break_crash", { gain: 0.4, delay: 0.15, maxDur: 1.2 }, 0.3]),
  "break.bulldozer": layers(["break_clank", { gain: 0.8 }], ["break_stall", { gain: 0.6, delay: 0.2, maxDur: 3, fadeOut: 0.3 }]),
  "break.crane": layers(["break_crash", { gain: 0.7, minDur: 1.5, maxDur: 2.5, fadeOut: 0.2 }], ["break_hiss", { gain: 0.5, delay: 0.6 }]),
  "break.truck": layers(["break_backfire", { gain: 0.8 }], ["break_stall", { gain: 0.6, delay: 0.5, maxDur: 2.5, fadeOut: 0.3 }]),
  "repair.start": layers(["fix_clank", { gain: 0.5 }]),
  "repair.hit": layers(["fix_hammer", { gain: 0.6, rand: 0.12 }]),
  "repair.ratchet": layers(["fix_ratchet", { gain: 0.5, minDur: 0.6, maxDur: 1.5 }]),
  "repair.grinder": layers(["fix_grinder", { gain: 0.45, minDur: 1.5, maxDur: 3, fadeIn: 0.15, fadeOut: 0.15 }]),
  "repair.impact": layers(["fix_ratchet", { gain: 0.45, rate: 1.3, minDur: 0.5, maxDur: 0.9 }]),
  "fix.done": (e, out, o) => {
    const heavy = o.kind === "excavator" || o.kind === "bulldozer";
    return heavy ? layers(["start_tractor", { gain: 0.7, frag: [0, 4.5], fadeOut: 1, rand: 0.03 }])(e, out, o)
      : layers(["start_engine", { gain: 0.7, rand: 0.03 }])(e, out, o);
  },
  "amb.reverse": layers(["beep_reverse", { gain: 0.2, minDur: 2, maxDur: 4, shelf: -6, rand: 0 }]),
  "amb.clank": layers(["break_clank", { gain: 0.25, rate: 1.2 }], ["break_clank", { gain: 0.2, rate: 1.25, delay: 0.12 }], ["break_clank", { gain: 0.15, rate: 1.3, delay: 0.24 }, 0.5]),
  "helmet.drop": layers(["fix_clank", { gain: 0.5, rate: 1.4, maxDur: 0.7 }]),
  "scene.door": layers(["break_pipe", { gain: 0.5, rate: 0.6 }]),
  "scene.fire": layers(["break_pipe", { gain: 0.5, rate: 0.6 }]),
  "scene.return": (e, out, o) => Math.max(layers(["break_pipe", { gain: 0.45, rate: 0.6 }])(e, out, o), SYNTH["wait.nag"](e, out, { ...o, delay: (o.delay || 0) + 0.5 })),
};

// синтез, который есть и в режиме «Для опытных»
export const SYNTH = {
  "wait.nag": (e, out, o) => {                       // короткий двойной клаксон
    const t = T0(e, o), flt = { type: "lowpass", f: 2000 };
    for (const k of [0, 0.38]) for (const f of [330, 415]) tone(e, out, { type: "sawtooth", f, t: t + k, dur: 0.3, a: 0.01, peak: 0.07, filter: flt });
    return 0.75;
  },
  "steps": (e, out, o) => {                          // гравий
    const t = T0(e, o);
    noise(e, out, { kind: "pink", t, dur: 0.07, a: 0.004, peak: 0.12, type: "bandpass", f: 1200, q: 0.7 });
    for (let i = 0; i < 5; i++) noise(e, out, { t: t + Math.random() * 0.04, dur: 0.008, a: 0.001, peak: 0.05, type: "bandpass", f: rnd(2000, 4000), q: 2 });
    return 0.08;
  },
  "ui.click": TOY["ui.click"],
};
