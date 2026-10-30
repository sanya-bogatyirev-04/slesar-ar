// Звуковой движок на Web Audio: контекст и его разблокировка (iOS), шины и лимитер,
// ограничение полифонии, приглушение под голос, банк реальных записей (только «Для опытных»)
// и бесшовный «фон» из длинных записей. Рецепты звуков — в sfx.js.
import { TOY, REAL, SYNTH, SFX_FILES, SFX_ORDER, startToyAmbient } from "./sfx.js";

const SR = 22050;                 // реальные записи храним моно 22,05 кГц — иначе iPhone выгрузит вкладку
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dB = (x) => Math.pow(10, x / 20);

// ---------------------------------------------------------------------------
// Банк записей: загрузка, ужатие, нормализация, нарезка на фрагменты
// ---------------------------------------------------------------------------
function decode(ctx, arr) {
  // колбэк-вариант нужен старому Safari
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(arr, res, rej);
    if (p && p.then) p.then(res, rej);
  });
}

async function shrink(buf, region) {
  const [a, b] = region ? [region[0], Math.min(buf.duration, region[1])] : [0, buf.duration];
  const len = Math.max(1, Math.ceil((b - a) * SR));
  const off = new OfflineAudioContext(1, len, SR);       // моно: при подключении стерео в моно-контекст идёт сведение
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, a, b - a);
  return off.startRendering();
}

// RMS-огибающая в дБ: окно 10 мс, шаг 5 мс
function envelope(buf) {
  const x = buf.getChannelData(0), win = Math.round(0.01 * SR), hop = Math.round(0.005 * SR);
  const env = [];
  for (let i = 0; i + win <= x.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += x[k] * x[k];
    env.push(10 * Math.log10(s / win + 1e-12));
  }
  return { env, hop: hop / SR };
}

function normalize(buf, trimDb = 0) {
  const x = buf.getChannelData(0);
  const { env } = envelope(buf);
  const sorted = [...env].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.3)));
  const loud = top.reduce((a, b) => a + b, 0) / top.length;           // уровень громкой части, дБ
  let peak = 1e-6;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = Math.min(dB(Math.min(12, -20 - loud) + trimDb), 0.98 / peak);
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

// онсеты: рост > 9 дБ над минимумом за 50 мс и уровень ≥ пик − 30 дБ
export function sliceOnsets(buf, { maxLen = 1.5, minLen = 0.08 } = {}) {
  const { env, hop } = envelope(buf);
  const peak = Math.max(...env);
  const look = Math.round(0.05 / hop);
  const on = [];
  for (let i = 1; i < env.length; i++) {
    let mn = Infinity;
    for (let k = Math.max(0, i - look); k < i; k++) mn = Math.min(mn, env[k]);
    if (env[i] - mn > 9 && env[i] >= peak - 30 && (!on.length || i - on.at(-1) > look * 2)) on.push(i);
  }
  const frags = [];
  on.forEach((i, n) => {
    const next = n + 1 < on.length ? on[n + 1] * hop - 0.02 : buf.duration;
    let end = i;
    while (end < env.length && env[end] > peak - 35) end++;
    const s = Math.max(0, i * hop - 0.01);
    const e = Math.min(next, end * hop + 0.05, s + maxLen);
    if (e - s >= minLen) frags.push([s, e - s]);
  });
  return frags;
}

// нарезка по паузам: тишина ниже пика − 40 дБ дольше gap секунд
export function sliceByPauses(buf, { gap = 0.4, minLen = 0.3, maxLen = 6 } = {}) {
  const { env, hop } = envelope(buf);
  const peak = Math.max(...env);
  const frags = [];
  let start = -1, quiet = 0;
  for (let i = 0; i < env.length; i++) {
    const loud = env[i] > peak - 40;
    if (loud) { if (start < 0) start = i; quiet = 0; }
    else if (start >= 0 && ++quiet * hop > gap) {
      const s = Math.max(0, start * hop - 0.03), e = (i - quiet) * hop + 0.1;
      if (e - s >= minLen) frags.push([s, Math.min(e - s, maxLen)]);
      start = -1; quiet = 0;
    }
  }
  if (start >= 0) frags.push([start * hop, Math.min(buf.duration - start * hop, maxLen)]);
  return frags;
}

export class SampleBank {
  constructor(engine) {
    this.e = engine;
    this.buf = {};            // имя файла (без .mp3) → AudioBuffer
    this.frags = {};          // → [[offset, dur], …]
    this.loading = null;
    this.bytes = 0;
  }
  ready(name) { return !!this.buf[name]; }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (const name of SFX_ORDER) {             // последовательно: первыми — фон и поломки
        const spec = SFX_FILES[name];
        try {
          const arr = await fetch(`assets/sfx/${name}.mp3`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
          const raw = await decode(this.e.ctx, arr);
          const buf = await shrink(raw, spec.region);
          normalize(buf, spec.trim || 0);
          this.frags[name] = spec.frags || (spec.slice === "onsets" ? sliceOnsets(buf, spec) : spec.slice === "pauses" ? sliceByPauses(buf, spec) : [[0, buf.duration]]);
          if (!this.frags[name].length) this.frags[name] = [[0, buf.duration]];
          this.buf[name] = buf;
          this.bytes += buf.length * 4;
          this.e.onSampleLoaded?.(name);
        } catch (err) {
          console.warn("звук не загрузился:", name, err);     // остаётся синтез-заглушка
        }
      }
      return true;
    })();
    return this.loading;
  }

  // frag: "random" | номер | [offset, dur]; part: [доля начала, макс. длительность] для длинных кусков
  play(name, out, { frag = "random", rate = 1, gain = 1, delay = 0, fadeIn = 0.005, fadeOut = 0.03, minDur = 0, maxDur = 0, rand = 0.08, lp = 0, hp = 0, shelf = 0 } = {}) {
    const buf = this.buf[name];
    if (!buf) return 0;
    const ctx = this.e.ctx;
    const fr = this.frags[name];
    let [off, dur] = Array.isArray(frag) ? frag : fr[frag === "random" ? Math.floor(Math.random() * fr.length) : frag % fr.length];
    if (maxDur && dur > maxDur) {
      const d = minDur ? minDur + Math.random() * (maxDur - minDur) : maxDur;
      off += Math.random() * Math.max(0, dur - d);
      dur = d;
    }
    const r = rate * (1 + (Math.random() * 2 - 1) * rand);
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = r;
    const g = ctx.createGain();
    const lvl = gain * dB((Math.random() * 2 - 1) * 3);         // громкость ±3 дБ
    const real = dur / r;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + fadeIn);
    g.gain.setValueAtTime(lvl, t + Math.max(fadeIn, real - fadeOut));
    g.gain.linearRampToValueAtTime(0, t + real);
    let node = src;
    for (const [type, f, extra] of [["lowpass", lp], ["highpass", hp], ["highshelf", shelf ? 3000 : 0, shelf]]) {
      if (!f) continue;
      const bq = ctx.createBiquadFilter();
      bq.type = type; bq.frequency.value = f;
      if (type === "highshelf") bq.gain.value = extra;
      node.connect(bq); node = bq;
    }
    node.connect(g).connect(out);
    src.start(t, off, dur);
    src.stop(t + real + 0.05);
    return delay + real;
  }
}

// ---------------------------------------------------------------------------
// Бесшовный фон: куски 8–14 с со случайного места, кроссфейд equal-power
// ---------------------------------------------------------------------------
const FADE_IN = new Float32Array(32).map((_, i) => Math.sin((i / 31) * Math.PI / 2));
const FADE_OUT = new Float32Array(32).map((_, i) => Math.cos((i / 31) * Math.PI / 2));

export class LoopBed {
  constructor(engine, name, out, { segMin = 8, segMax = 14, xfade = 2, hp = 0 } = {}) {
    Object.assign(this, { e: engine, name, segMin, segMax, xfade });
    const ctx = engine.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    let node = this.gain;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; node.connect(f); node = f; }
    node.connect(out);
    this.next = 0;
    this.running = false;
    this.srcs = [];
  }
  start() { this.running = true; this.next = 0; }
  stop() { this.running = false; for (const s of this.srcs) try { s.stop(); } catch (e) { /* уже остановлен */ } this.srcs = []; }
  setGain(v, tau = 0.6) { const c = this.e.ctx; this.gain.gain.setTargetAtTime(v, c.currentTime, tau); }

  // планирование на 1 с вперёд; вызывается каждый кадр
  update() {
    const buf = this.e.bank.buf[this.name];
    if (!this.running || !buf) return;
    const ctx = this.e.ctx, now = ctx.currentTime;
    if (this.next && this.next - now > 1) return;
    const t = Math.max(now + 0.05, this.next || 0);
    const seg = Math.min(buf.duration - 0.5, this.segMin + Math.random() * (this.segMax - this.segMin));
    const x = Math.min(this.xfade, seg / 3);
    const off = Math.random() * Math.max(0, buf.duration - seg - x);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(FADE_IN, t, x);
    g.gain.setValueCurveAtTime(FADE_OUT, t + seg, x);
    src.connect(g).connect(this.gain);
    src.start(t, off, seg + x + 0.02);
    src.onended = () => { this.srcs = this.srcs.filter((s) => s !== src); };
    this.srcs.push(src);
    this.next = t + seg;
  }
}

// ---------------------------------------------------------------------------
// Движок
// ---------------------------------------------------------------------------
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.set = "toy";
    this.volume = 0.8;
    this.muted = false;
    this.ambOn = true;
    this.paused = false;
    this.active = [];                     // {id, end, g}
    this.lastPlay = new Map();
    this.recent = [];                     // времена запусков за последнюю секунду
    this.speedFactor = 1;
    this.bank = null;
    this.beds = null;
    this.load = { dig: 1, haul: 1, all: 1 };
  }

  // СИНХРОННО в обработчике клика — иначе iOS не разрешит звук
  unlockSync() {
    try {
      if (!this.muted && navigator.audioSession) navigator.audioSession.type = "playback";   // Safari 17+: звук и при беззвучном режиме
    } catch (e) { /* старый Safari */ }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.build();
    }
    this.ctx.resume?.();
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);
  }

  build() {
    const ctx = this.ctx;
    const lim = ctx.createDynamicsCompressor();       // лимитер
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12;
    lim.attack.value = 0.003; lim.release.value = 0.25;
    lim.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(lim);
    this.bus = {};
    this.duckG = {};
    for (const name of ["amb", "sfx", "ui", "voice"]) {
      const g = ctx.createGain();
      const d = ctx.createGain();                    // отдельный узел для приглушения и паузы
      g.connect(d).connect(this.master);
      this.bus[name] = g; this.duckG[name] = d;
    }
    // шумы по 2 с (белый, розовый — Paul Kellet, коричневый)
    const n = ctx.sampleRate * 2;
    const mk = (fill) => { const b = ctx.createBuffer(1, n, ctx.sampleRate); fill(b.getChannelData(0)); return b; };
    this.noise = {
      white: mk((d) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }),
      pink: mk((d) => {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      }),
      brown: mk((d) => { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }),
    };
    this.applyVolume();
    // iOS: после звонка или блокировки контекст «interrupted» — первое касание возвращает звук
    const wake = () => { if (this.ctx.state !== "running" && !this.muted && !this.paused && !document.hidden) this.ctx.resume(); };
    document.addEventListener("pointerdown", wake);
    document.addEventListener("touchend", wake);
    this.toyAmb = startToyAmbient(this, this.bus.amb);
    this.toyAmb.gain.gain.value = 0;
    this.setSet(this.set, true);
  }

  get ready() { return !!this.ctx; }

  // "toy" | "real": кроссфейд фона ~1 с; оба набора остаются в памяти
  setSet(set, instant = false) {
    this.set = set;
    if (!this.ctx) return;
    const now = this.ctx.currentTime, tau = instant ? 0.01 : 0.35;
    if (set === "real") {
      if (!this.bank) {
        this.bank = new SampleBank(this);
        this.beds = {
          site: new LoopBed(this, "amb_site", this.bus.amb),
          dig: new LoopBed(this, "amb_excavator", this.bus.amb),
          haul: new LoopBed(this, "amb_diesel", this.bus.amb, { hp: 2500 }),
        };
        this.onLoadStart?.();
        this.bank.load().then(() => this.onLoadDone?.());
      }
      for (const b of Object.values(this.beds)) b.start();
    } else if (this.beds) {
      for (const b of Object.values(this.beds)) { b.setGain(0, tau); }
      setTimeout(() => { if (this.set !== "real") for (const b of Object.values(this.beds)) b.stop(); }, 1500);
    }
    this.toyAmb.gain.gain.setTargetAtTime(set === "toy" && this.ambOn ? 1 : 0, now, tau);   // внутри ≈ −36 дБ
    this.setLoad(this.load);
  }

  // доля работающих машин: чем больше простой, тем тише площадка (так звук «озвучивает» модель)
  setLoad(load) {
    this.load = load;
    if (!this.ctx || this.set !== "real" || !this.beds) return;
    const on = this.ambOn ? 1 : 0;
    this.beds.site.setGain(on * 0.3, 0.7);
    this.beds.dig.setGain(on * (0.05 + 0.35 * load.dig), 0.7);
    this.beds.haul.setGain(on * (0.05 + 0.25 * load.haul), 0.7);
  }

  setAmbOn(b) { this.ambOn = b; if (this.ctx) this.setSet(this.set); }
  setVolume(v) { this.volume = clamp(v, 0, 1); this.applyVolume(); }
  setMuted(b) { this.muted = b; this.applyVolume(); if (!b && this.ctx && !this.paused) this.ctx.resume(); }
  applyVolume() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, this.ctx.currentTime, 0.05);
  }
  // пауза игры: фон и звуки площадки — в ноль за 0,3 с
  setPaused(b) {
    this.paused = b;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const k of ["amb", "sfx"]) this.duckG[k].gain.setTargetAtTime(b ? 0 : this.duckLevel(k), t, 0.1);
  }
  // вкладка скрыта — контекст спит
  setHidden(b) {
    if (!this.ctx) return;
    if (b) this.ctx.suspend?.(); else if (!this.muted) this.ctx.resume?.();
  }
  duckLevel(k) { return (this.ducked ? (k === "amb" ? dB(-12) : dB(-8)) : 1) * (this.sceneDuck && k !== "voice" ? dB(-6) : 1); }
  duck(on) {
    this.ducked = on;
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    for (const k of ["amb", "sfx"]) this.duckG[k].gain.setTargetAtTime(this.duckLevel(k), t, on ? 0.05 : 0.15);
  }
  setSceneDuck(on) { this.sceneDuck = on; this.duck(this.ducked); }

  update() {
    if (this.beds && this.set === "real") for (const b of Object.values(this.beds)) b.update();
  }

  // выход одного звука: Gain → StereoPanner → шина
  out(bus, pan = 0, gain = 1) {
    const ctx = this.ctx;
    if (!Number.isFinite(pan)) pan = 0;            // окно нулевого размера (свёрнуто) — проекция даёт NaN
    if (!Number.isFinite(gain)) gain = 1;
    const g = ctx.createGain();
    g.gain.value = gain;
    let p;
    if (ctx.createStereoPanner) { p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); }
    else { p = ctx.createPanner(); p.panningModel = "equalpower"; p.setPosition(pan, 0, 1 - Math.abs(pan)); }
    g.connect(p).connect(this.bus[bus] || this.bus.sfx);
    return g;
  }

  // id из §6.2: break.excavator, repair.hit, fix.done, … ; opts: pan, gain, delay, minor (мелкий звук)
  play(id, { pan = 0, gain = 1, delay = 0, minor = false, kind = null, bus = "sfx" } = {}) {
    if (!this.ctx || this.muted || this.ctx.state !== "running") return null;
    if (this.paused && bus !== "ui") return null;
    const now = performance.now() / 1000;
    if (minor && this.speedFactor > 1 && Math.random() > 1 / this.speedFactor) return null;
    if (Math.abs(now + delay - (this.lastPlay.get(id) || 0)) < 0.12) return null;   // один и тот же — не чаще 120 мс (с учётом задержки)
    this.recent = this.recent.filter((t) => now - t < 1);
    if (this.recent.length >= 8) return null;                                // не больше 8 запусков в секунду
    const t = this.ctx.currentTime;
    this.active = this.active.filter((a) => a.end > t);
    if (this.active.length >= 10) {                                          // при переполнении глушим самый старый
      const old = this.active.shift();
      old.g.gain.setTargetAtTime(0, t, 0.02);
    }
    let recipe = null;
    if (this.set === "real") recipe = REAL[id] || SYNTH[id];
    if (!recipe) recipe = TOY[id];
    if (!recipe) return null;
    const out = this.out(bus, pan, gain);
    let dur = 0;
    try { dur = recipe(this, out, { delay, kind }) || 0; } catch (e) { console.warn("звук", id, e); }
    if (!dur && this.set === "real" && REAL[id] && TOY[id]) dur = TOY[id](this, out, { delay, kind }) || 0;   // файл ещё не загрузился — заглушка
    this.lastPlay.set(id, now + delay);
    this.recent.push(now);
    const h = { id, end: t + delay + dur + 0.1, g: out };
    this.active.push(h);
    setTimeout(() => { try { out.disconnect(); } catch (e) { /* уже отключён */ } }, (delay + dur + 0.5) * 1000);
    return h;
  }

  get memoryMB() { return this.bank ? this.bank.bytes / 1048576 : 0; }
}
