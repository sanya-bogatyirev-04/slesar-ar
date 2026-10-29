// Озвучка реплик. Основной путь — заранее записанные файлы assets/voice/<id>.mp3
// (голоса Windows Pavel / Irina, tools/make_voices.ps1): одинаково разборчиво на любом
// телефоне. Откат — speechSynthesis браузера (только русский голос), последний откат —
// «только субтитры». Очередь с приоритетами: сценка (≥ 90) вытесняет текущую фразу.
import { loadLines, role } from "./lines.js";

const now = () => performance.now() / 1000;
const NO_VOICE = new URLSearchParams(location.search).has("novoice");

// оценка голоса браузера (§7.2): русский, «естественный», локальный
function scoreVoice(v) {
  let s = 0;
  if (v.lang === "ru-RU") s += 3;
  if (/natural|enhanced|premium|neural|улучш/i.test(v.name)) s += 3;
  if (/google/i.test(v.name)) s += 1;
  if (v.localService) s += 1;
  if (/compact/i.test(v.name)) s -= 2;
  return s;
}
const isMale = (v) => /dmitry|pavel|yuri|maxim|юрий|дмитрий|павел|male/i.test(v.name) && !/female/i.test(v.name);
const isFemale = (v) => /irina|svetlana|milena|katya|dariya|ирина|светлана|милена|female/i.test(v.name);

export class Voice {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.volume = 1;
    this.queue = [];
    this.current = null;
    this.lastEnd = 0;
    this.manifest = null;
    this.bytes = new Map();      // id → Promise<ArrayBuffer> (сжатые файлы)
    this.decoded = new Map();    // id → AudioBuffer, LRU на 16
    this.web = { male: null, female: null, any: null };
    this.ttsFails = 0;
    this.ttsBroken = false;
    this.warned = new Set();
    this.utters = [];            // ссылки на фразы TTS: иначе Chrome их соберёт и onend не придёт
    this.ready = null;
  }

  // в обработчике клика: «разогреть» речь браузера (iOS требует жест пользователя)
  unlockSync() {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (e) { /* нет речи — не страшно */ }
  }

  init(set) {
    if (!this.ready) this.ready = (async () => {
      await loadLines();
      try {
        const r = await fetch("assets/voice/voice-manifest.json");
        if (r.ok) this.manifest = await r.json();
      } catch (e) { /* нет манифеста — будет речь браузера */ }
      await this.pickWebVoices();
      return { files: !!this.manifest, web: this.web };
    })();
    this.ready.then(() => this.prefetch(set));
    return this.ready;
  }

  get available() { return !NO_VOICE && (!!this.manifest || (!!this.web.any && !this.ttsBroken)); }

  pickWebVoices() {
    if (!window.speechSynthesis) return;
    return new Promise((res) => {
      const pick = () => {
        const ru = speechSynthesis.getVoices().filter((v) => /^ru/i.test(v.lang));   // нерусский голос кириллицу не читает
        ru.sort((a, b) => scoreVoice(b) - scoreVoice(a));
        this.web = { any: ru[0] || null, male: ru.find(isMale) || null, female: ru.find(isFemale) || null };
        return ru.length > 0;
      };
      if (pick()) return res();
      const t = setTimeout(res, 1500);                 // Chrome отдаёт голоса асинхронно
      speechSynthesis.addEventListener?.("voiceschanged", () => { if (pick()) { clearTimeout(t); res(); } }, { once: true });
    });
  }

  // фоновая загрузка сжатых файлов текущей версии (≈0,9 МБ)
  async prefetch(set) {
    if (!this.manifest) return;
    const pre = set === "adult" ? "a-" : "c-";
    for (const id of Object.keys(this.manifest.items)) if (id.startsWith(pre)) await this.fetchBytes(id).catch(() => {});
  }
  fetchBytes(id) {
    if (!this.bytes.has(id)) {
      const it = this.manifest.items[id];
      this.bytes.set(id, fetch("assets/voice/" + it.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
    }
    return this.bytes.get(id);
  }
  async decode(id) {
    if (this.decoded.has(id)) {
      const b = this.decoded.get(id);
      this.decoded.delete(id); this.decoded.set(id, b);           // LRU: свежий — в конец
      return b;
    }
    const arr = await this.fetchBytes(id);
    const ctx = this.audio.ctx;
    const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(arr.slice(0), res, rej); if (p?.then) p.then(res, rej); });
    this.decoded.set(id, buf);
    while (this.decoded.size > 16) this.decoded.delete(this.decoded.keys().next().value);
    return buf;
  }
  // перед сценкой — заранее декодировать её реплики
  preload(lines) { for (const l of lines) if (l && this.fileFor(l)) this.decode(l.id).catch(() => {}); }

  fileFor(line) {
    const it = this.manifest?.items?.[line.id];
    if (!it) return null;
    if (it.text !== (line.s || line.t)) {
      if (!this.warned.has(line.id)) { this.warned.add(line.id); console.warn(`озвучка ${line.id}: текст изменился — перезапишите make_voices.ps1; пока говорит браузер`); }
      return null;
    }
    return it;
  }

  // line: {id, who, t, s}; priority; ttl; pan; onStart(dur, mode); onEnd(status)
  say({ line, priority = 40, ttl = 3, pan = 0, onStart, onEnd }) {
    return new Promise((resolve) => {
      const item = { line, priority, pan, onStart, onEnd, resolve, exp: now() + ttl };
      if (this.current && priority >= 90 && this.current.priority < priority) this.stopCurrent("cancelled");
      this.queue.push(item);
      this.queue.sort((a, b) => b.priority - a.priority);
      while (this.queue.length > 3) this.settle(this.queue.pop(), "dropped");
      this.pump();
    });
  }

  settle(item, status) {
    try { item.onEnd?.(status); } catch (e) { console.error(e); }
    item.resolve(status);
  }

  pump() {
    if (this.current) return;
    clearTimeout(this.pumpTimer);
    const t = now();
    this.queue = this.queue.filter((i) => (i.exp >= t ? true : (this.settle(i, "dropped"), false)));
    if (!this.queue.length) return;
    const wait = this.lastEnd + 0.35 - t;                       // пауза между фразами
    if (wait > 0) { this.pumpTimer = setTimeout(() => this.pump(), wait * 1000); return; }
    this.start(this.queue.shift());
  }

  async start(item) {
    this.current = item;
    const line = item.line;
    const r = role(line.who);
    const silent = NO_VOICE || !this.enabled || this.audio.muted || !this.audio.ready;
    const file = !silent && this.fileFor(line);
    if (file) {
      try {
        const buf = await this.decode(line.id);
        if (this.current !== item) return;
        return this.playBuffer(item, buf, r);
      } catch (e) { console.warn("озвучка: файл", line.id, e); }
      if (this.current !== item) return;
    }
    if (!silent && this.web.any && !this.ttsBroken && window.speechSynthesis) return this.speakTTS(item, r);
    this.playSilent(item);
  }

  playBuffer(item, buf, r) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1.15 * this.volume;
    let node = src;
    if (r.fx === "radio") {                                     // прораб «по рации»
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400;
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5); }
      ws.curve = curve;
      node.connect(hp).connect(lp).connect(ws); node = ws;
    }
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-0.3, Math.min(0.3, item.pan)); node.connect(g).connect(p).connect(this.audio.bus.voice); }
    else node.connect(g).connect(this.audio.bus.voice);
    item.stop = () => { try { src.stop(); } catch (e) { /* уже */ } };
    src.onended = () => this.finish(item, item.cancelled ? "cancelled" : "done");
    this.audio.duck(true);
    src.start();
    try { item.onStart?.(buf.duration, "file"); } catch (e) { console.error(e); }
  }

  speakTTS(item, r) {
    const line = item.line;
    const text = (line.s || line.t).replace(/…/g, ",").replace(/[—–]/g, ",");
    const u = new SpeechSynthesisUtterance(text);
    const female = r.voice === "Irina";
    const v = (female ? this.web.female : this.web.male) || this.web.any;
    u.voice = v; u.lang = v.lang || "ru-RU";
    let pitch = r.web?.pitch ?? r.pitch ?? 1;
    if (!female && v && isFemale(v)) pitch = Math.max(0.65, pitch * 0.85);       // мужская роль женским голосом — ниже
    u.pitch = pitch;
    u.rate = r.web?.rate ?? r.rate ?? 1;
    u.volume = Math.min(1, this.volume * this.audio.volume);
    const est = 1.0 + (0.075 * text.length) / u.rate;
    let started = false;
    this.utters.push(u);
    const startGuard = setTimeout(() => {                         // onstart не пришёл — речь не работает
      if (started || this.current !== item) return;
      if (++this.ttsFails >= 2) { this.ttsBroken = true; this.onNoVoice?.(); }
      speechSynthesis.cancel();
      item.cancelled = true;
      this.finish(item, "error");
    }, 1500);
    const watchdog = setTimeout(() => {                           // сторож зависаний: onend не пришёл
      if (this.current === item) { speechSynthesis.cancel(); this.finish(item, "done"); }
    }, est * 1.8 * 1000 + 1500);
    u.onstart = () => {
      started = true; this.ttsFails = 0;
      clearTimeout(startGuard);
      this.audio.duck(true);
      try { item.onStart?.(est, "tts"); } catch (e) { console.error(e); }
    };
    const end = (status) => { clearTimeout(startGuard); clearTimeout(watchdog); this.utters = this.utters.filter((x) => x !== u); this.finish(item, status); };
    u.onend = () => end(item.cancelled ? "cancelled" : "done");
    u.onerror = (e) => {
      if (e.error === "not-allowed") {                            // iOS: речь не разблокирована — ждём касания
        document.addEventListener("pointerdown", () => this.unlockSync(), { once: true });
      }
      end(item.cancelled ? "cancelled" : "error");
    };
    item.stop = () => speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // без голоса: пузырь живёт расчётное время
  playSilent(item) {
    const text = item.line.t;
    const dur = 1.2 + 0.06 * text.length;
    const t = setTimeout(() => this.finish(item, "silent"), dur * 1000);
    item.stop = () => clearTimeout(t);
    try { item.onStart?.(dur, "silent"); } catch (e) { console.error(e); }
  }

  finish(item, status) {
    if (this.current !== item) return;
    this.current = null;
    this.lastEnd = now();
    this.audio.duck(false);
    this.settle(item, status);
    this.pump();
  }

  stopCurrent(status = "cancelled") {
    const it = this.current;
    if (!it) return;
    it.cancelled = true;
    try { it.stop?.(); } catch (e) { /* уже */ }
    this.finish(it, status);
  }

  cancelAll() {
    for (const i of this.queue.splice(0)) this.settle(i, "cancelled");
    this.stopCurrent("cancelled");
    try { window.speechSynthesis?.cancel(); } catch (e) { /* нет речи */ }
  }

  // смена версии: сбросить очередь и декодированное, догрузить файлы другой версии
  setSet(set) { this.cancelAll(); this.decoded.clear(); this.ready?.then(() => this.prefetch(set)); }
  setEnabled(b) { this.enabled = b; if (!b) this.cancelAll(); }
  setVolume(v) { this.volume = v; }
  get busy() { return !!this.current || this.queue.length > 0; }
}
