// «Режиссёр»: превращает события модели и площадки в звуки, реплики и пузыри-субтитры.
// Ничего не меняет в модели: только слушает World.onEvent и Site.on, опрашивает слесарей
// (atJob → звуки ремонта) и ставит сценки увольнения / возвращения 3-го разряда.
import * as THREE from "three";
import { LinePicker, role } from "./lines.js";
import { EDITION_CFG } from "./edition.js";

const now = () => performance.now() / 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const WHO = { 6: "w6", 3: "w3" };

// какие звуки ремонта у какой машины (набор real); в toy — «тук-тук»
const REPAIR = {
  excavator: ["repair.ratchet", "repair.hit"],
  bulldozer: ["repair.hit", "repair.hit", "repair.hit", "repair.grinder"],
  crane: ["repair.ratchet", "repair.grinder"],
  truck: ["repair.impact", "repair.ratchet"],
};
// минимальный интервал категории, с (по умолчанию 15)
const CAT_GAP = { "foreman.rant": 25, "solo.overload": 30, "wait.long": 12, "repair.switch": 20 };

// жесты для игрушечных слесарей (у реалистичных моделей свои): подпрыгнуть, помахать, грусть
const G_DUR = { shock: 0.8, shrug: 0.9, angry: 1.2, wave: 1.5, waveOff: 1, sad: 1.6, facepalm: 1.2, highFive: 0.8, cheer: 1, pickUp: 1.2, throwHelmet: 1.4 };
function installClassicGestures(obj) {
  const st = { name: null, t: 0, dur: 0, res: null };
  const parts = obj.userData.parts;
  obj.userData.gesture = (name) => new Promise((res) => {
    st.res?.();
    Object.assign(st, { name, t: 0, dur: G_DUR[name] || 1, res });
  });
  obj.userData.update = (dt) => {
    if (!st.name) { parts.body.rotation.z = 0; return; }
    st.t += dt;
    const k = st.t / st.dur, s = Math.sin(Math.PI * Math.min(1, k));
    if (["shock", "cheer", "highFive", "throwHelmet", "pickUp"].includes(st.name)) parts.body.position.y = 0.016 + Math.abs(Math.sin(st.t * 12)) * 0.006 * s;
    if (["wave", "waveOff", "shrug", "angry"].includes(st.name)) parts.wrench.rotation.z = Math.sin(st.t * 6 * Math.PI * 2) * 0.9 * s;
    if (["sad", "facepalm"].includes(st.name)) parts.body.rotation.z = 0.15 * s;
    if (k >= 1) { parts.body.rotation.z = 0; const r = st.res; st.name = null; st.res = null; r?.(); }
  };
}

export class Director {
  constructor({ audio, voice, bubbles, edition }) {
    Object.assign(this, { audio, voice, bubbles });
    this.picker = new LinePicker();
    this.worlds = [];
    this.view = null;
    this.tracking = true;
    this.paused = false;
    this.sceneToken = 0;
    this.sceneActive = false;
    this.waiters = [];
    this.setEdition(edition, true);
  }

  // смена версии на лету: оборвать речь, пузыри, сценку и циклы; новые пулы и лимиты
  setEdition(ed, quiet = false) {
    this.ed = ed;
    this.cfg = EDITION_CFG[ed];
    this.picker.reset();
    this.bubbles.setStyle(this.cfg.bubbleStyle);
    this.reset();
    if (!quiet) this.edAnnounce = now() + 0.8;            // прораб прокомментирует смену версии
  }

  reset() {
    this.sceneToken++;
    this.sceneActive = false;
    this.audio.setSceneDuck?.(false);
    this.voice.cancelAll();
    this.bubbles.clear();
    this.loops = new Map();
    this.prevAtJob = new Map();
    this.prevJobs = new Map();
    this.bullDir = new Map();
    this.lastCat = new Map();
    this.lastLine = 0;
    this.tokens = this.cfg.linesPerMin;
    this.tokT = now();
    this.frameKeys = new Set();
    this.timer5 = 2;
    this.reverseT = rnd(6, 12);
    this.steps = null;
    this.afterGone = null;
    for (const w of this.waiters) w.res();
    this.waiters = [];
  }

  // при каждой сборке миров (и после смены версии): повторный вызов без утечек
  attach(worlds, mode) {
    this.reset();
    this.worlds = worlds;
    this.mode = mode;
    this.focus = mode === "both" ? 1 : 0;                 // в «Двух мирах» озвучиваем мир без 3-го: там драма
    worlds.forEach((w, i) => {
      w.onEvent = (ev, world) => this.onWorld(i, ev, world);
      w.site.on = (name, data) => this.onSite(i, name, data);
      w.site.stageExit = mode !== "both";
    });
  }

  setView(view) { this.view = view; }
  setFocus(i) { this.focus = i; this.voice.cancelAll(); this.bubbles.clear(); }
  setTracking(found) {
    this.tracking = found;
    if (!found) { this.voice.cancelAll(); this.bubbles.clear(); }
  }
  setPaused(b) {
    this.paused = b;
    this.audio.setPaused(b);
    if (b) { this.voice.cancelAll(); this.bubbles.clear(); }
  }

  // ---------------------------------------------------------------------------
  // пространство: панорама по экрану
  // ---------------------------------------------------------------------------
  spatial(obj, wi = 0) {
    let pan = 0;
    const cam = this.view?.camera;
    if (cam && obj) {
      const v = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld).project(cam);
      pan = Number.isFinite(v.x) ? clamp(v.x * 0.8, -0.8, 0.8) : 0;
    }
    return { pan, gain: this.mode === "both" ? 0.6 : 1 };
  }

  sfx(id, obj, wi, extra = {}) {
    return this.audio.play(id, { ...this.spatial(obj, wi), ...extra });
  }

  // ---------------------------------------------------------------------------
  // якоря пузырей
  // ---------------------------------------------------------------------------
  anchorMachine(mc) {
    return () => (mc.obj.parent ? mc.obj.localToWorld(new THREE.Vector3(0, mc.obj.userData.top + 0.03, 0)) : null);
  }
  anchorWorker(site, g) {
    return () => {
      const w = site.workers[g];
      return w && w.obj.parent ? w.obj.localToWorld(new THREE.Vector3(0, (w.obj.userData.badgeY ?? 0.05) + 0.012, 0)) : null;
    };
  }
  anchorForeman(site) {
    return () => {
      if (!site.group.parent) return null;
      if (site.boss?.parent) return site.boss.localToWorld(new THREE.Vector3(0, 0.05, 0));
      return site.trailerTop ? site.group.localToWorld(site.trailerTop.clone()) : null;
    };
  }
  anchorFor(who, site, mc) {
    if (who === "w6") return this.anchorWorker(site, "6");
    if (who === "w3") return this.anchorWorker(site, "3");
    if (who === "foreman") return this.anchorForeman(site);
    return mc ? this.anchorMachine(mc) : this.anchorForeman(site);
  }

  // ---------------------------------------------------------------------------
  // реплики
  // ---------------------------------------------------------------------------
  sayLine(line, { anchor, label, priority = 40, ttl = 3, pan = 0 }) {
    let bubble = null;
    const r = role(line.who);
    return this.voice.say({
      line, priority, ttl, pan,
      onStart: () => { bubble = this.bubbles.show({ who: line.who, label: label || r.label, text: line.t, anchor }); },
      onEnd: () => this.bubbles.hide(bubble, 0.6),
    });
  }

  canSpeak(cat, wi) {
    if (this.paused || !this.tracking || this.sceneActive) return false;
    if (wi !== undefined && wi !== this.focus) return false;
    const t = now();
    this.tokens = Math.min(this.cfg.linesPerMin, this.tokens + ((t - this.tokT) * this.cfg.linesPerMin) / 60);
    this.tokT = t;
    if (this.tokens < 1) return false;
    if (t - this.lastLine < this.cfg.voiceMinGap) return false;
    if (t - (this.lastCat.get(cat) ?? -1e9) < (CAT_GAP[cat] ?? 15)) return false;
    if (this.voice.busy) return false;
    return true;
  }

  // реплика по категории; who-фильтр, якорь; для машинистов подпись по виду машины
  speak(cat, { wi, site, mc, p = 1, priority = 40, filter = null } = {}) {
    if (Math.random() > p || !this.canSpeak(cat, wi)) return null;
    site ??= this.worlds[wi ?? 0]?.site;
    let c = cat;
    if (mc?.kind === "crane" && this.picker.has(this.cfg.linesSet, cat + ".crane")) c = cat + ".crane";   // Люба — свои реплики
    else if (mc?.kind === "crane" && /^(fix\.thanks|wait\.)/.test(cat)) return null;
    const present = (l) => l.who !== "w3" || (site?.workers["3"] && !site.workers["3"].leaving);
    const line = this.picker.pick(this.cfg.linesSet, c, (l) => present(l) && (!filter || filter(l)));
    if (!line) return null;
    const t = now();
    this.lastLine = t; this.lastCat.set(cat, t); this.tokens -= 1;
    const label = line.who === "op" && mc ? role("op." + mc.kind).label : null;
    const pan = mc ? this.spatial(mc.obj).pan : 0;
    return this.sayLine(line, { anchor: this.anchorFor(line.who, site, mc), label, priority, pan });
  }

  // ---------------------------------------------------------------------------
  // события модели
  // ---------------------------------------------------------------------------
  onWorld(wi, ev, world) {
    const site = world.site;
    const mc = ev.type !== undefined ? site.machines.get(`${ev.type}:${ev.idx}`) : null;
    const hps = this.hoursPerSec || 0.33;
    if (ev.kind === "break" && mc) {
      const key = `break:${ev.type}:${ev.idx}`;                // одинаковые поломки двух миров — один звук
      if (!this.frameKeys.has(key)) { this.frameKeys.add(key); this.sfx("break." + mc.kind, mc.obj, wi, { kind: mc.kind }); }
      const p = clamp(0.4 / Math.max(1, hps / 0.33), 0.12, 0.4) * (mc.kind === "crane" ? 1.3 : 1);
      this.speak("break." + mc.kind, { wi, site, mc, p, priority: mc.kind === "crane" ? 50 : 40 });
    } else if (ev.kind === "fix" && mc) {
      this.loops.delete(`${wi}:${ev.type}:${ev.idx}`);
      const key = `fix:${ev.type}:${ev.idx}`;
      if (!this.frameKeys.has(key)) { this.frameKeys.add(key); this.sfx("fix.done", mc.obj, wi, { kind: mc.kind }); }
      if (ev.down > 2) this.speak("wait.over", { wi, site, mc, p: 0.5, priority: 45 });
      else if (Math.random() < 0.5) {
        const who = (ev.who || []).map((g) => WHO[g]);
        this.speak("repair.done", { wi, site, mc, p: 0.35, filter: (l) => who.includes(l.who) });
      } else this.speak("fix.thanks", { wi, site, mc, p: 0.35 });
    } else if (ev.kind === "alloc") {
      // переброска 6-го на другую машину, хотя прежняя ещё не починена
      for (const w of Object.values(site.workers)) {
        const k = `${wi}:${w.grade}`, prev = this.prevJobs.get(k);
        if (w.grade === "6" && prev && w.job && prev !== w.job && prev.state !== "work") this.speak("repair.switch", { wi, site, p: 0.5 });
        this.prevJobs.set(k, w.job);
      }
    } else if (ev.kind === "longwait" && mc) {
      if (this.speak("wait.long", { wi, site, mc, p: 0.7, priority: 42 })) this.sfx("wait.nag", mc.obj, wi, { minor: true });
    } else if (ev.kind === "day-start") {
      if (world.day > 1) this.speak("shift.start", { wi, site, p: 0.5, priority: 35 });
    } else if (ev.kind === "day-end") {
      this.lastLine = 0;
      this.speak("shift.end", { wi, site, p: 0.7, priority: 60 });
    }
  }

  onSite(wi, name, data) {
    const site = this.worlds[wi]?.site;
    if (!site || this.mode === "both") return;
    if (name === "fire") this.sceneFire(site, data);
    else if (name === "hire") this.sceneReturn(site, data);
    else if (name === "stay") this.sceneStay(site, data);
    else if (name === "gone" && this.afterGone?.tok === this.sceneToken) {
      const tok = this.afterGone.tok;
      this.afterGone = null;
      this.steps = null;
      if (Math.random() < 0.8) setTimeout(() => tok === this.sceneToken && this.sceneLine(tok, "fire.after", site), 400);
    }
  }

  // ---------------------------------------------------------------------------
  // сценки
  // ---------------------------------------------------------------------------
  waitFor(cond, timeout) { return new Promise((res) => this.waiters.push({ cond, until: now() + timeout, res })); }
  sleep(s) { return this.waitFor(() => false, s); }
  arrived(site, g, pos) {
    const w = site.workers[g];
    return !w || w.obj.position.distanceTo(new THREE.Vector3(pos.x, w.obj.position.y, pos.z)) < 0.005;
  }
  gesture(obj, name, site) { return obj?.userData.gesture?.(name, { site, director: this }) ?? Promise.resolve(); }

  beginScene() {
    const tok = ++this.sceneToken;
    this.voice.cancelAll();
    this.bubbles.clear();
    this.sceneActive = true;
    this.audio.setSceneDuck(true);
    return tok;
  }
  endScene(tok) {
    if (tok !== this.sceneToken) return;
    this.sceneActive = false;
    this.audio.setSceneDuck(false);
    this.lastLine = now();
  }

  // шаг сценки: фраза с приоритетом 100 и ожиданием её конца + 0,3 с
  async sceneLine(tok, cat, site) {
    if (tok !== this.sceneToken) return false;
    // пауза (в т. ч. открытый «Вердикт») или потеря метки в AR — сценка ждёт, ничего не говорит
    await this.waitFor(() => tok !== this.sceneToken || (!this.paused && this.tracking), 600);
    if (tok !== this.sceneToken) return false;
    const line = this.picker.pick(this.cfg.linesSet, cat);
    if (line) {
      await this.sayLine(line, { anchor: this.anchorFor(line.who, site), priority: 100, ttl: 10 });
      await this.sleep(0.3);
    }
    return tok === this.sceneToken;
  }

  async sceneFire(site, w3) {
    const tok = this.beginScene();
    const adult = this.ed === "adult";
    const w6 = () => site.workers["6"]?.obj;
    const spot = site.trailerPos.clone().add(new THREE.Vector3(0.02, 0, 0.03));
    site.stageWorker("3", spot);
    this.steps = { site, g: "3", t: 0 };
    await this.waitFor(() => this.arrived(site, "3", spot), 4);
    this.steps = null;
    if (tok !== this.sceneToken) return;
    this.gesture(site.boss, "angry", site);
    if (!await this.sceneLine(tok, "fire.boss", site)) return;
    this.gesture(w3.obj, "shock", site);
    if (!await this.sceneLine(tok, "fire.r3_shock", site)) return;
    this.gesture(w6(), "shrug", site);
    if (!await this.sceneLine(tok, "fire.r6", site)) return;
    if (adult) {
      this.gesture(w3.obj, "throwHelmet", site).then(() => {});
      setTimeout(() => tok === this.sceneToken && this.sfx("helmet.drop", w3.obj, 0), 1100);
      if (!await this.sceneLine(tok, "fire.r3_rage", site)) return;
    } else {
      this.gesture(w3.obj, "sad", site);
      if (!await this.sceneLine(tok, "fire.r3_sad", site)) return;
    }
    this.gesture(w3.obj, adult ? "waveOff" : "wave", site);
    if (!await this.sceneLine(tok, "fire.r3_bye", site)) return;
    this.sfx(adult ? "scene.door" : "scene.fire", w3.obj, 0);
    site.releaseWorker("3");
    this.steps = { site, g: "3", t: 0 };
    this.afterGone = { tok };
    this.endScene(tok);
  }

  async sceneReturn(site, w3) {
    const tok = this.beginScene();
    const adult = this.ed === "adult";
    if (adult && site.droppedHelmet?.parent) {
      // вернулся без каски — она лежит там, где он её бросил
      const own = w3.obj.userData.parts.helmet;
      if (own) { own.visible = false; setTimeout(() => (own.visible = true), 25000); }
    }
    this.sfx("scene.return", site.boss || w3.obj, 0);
    if (!await this.sceneLine(tok, "return.boss", site)) return;
    this.steps = { site, g: "3", t: 0 };
    if (!await this.sceneLine(tok, "return.r3_hello", site)) return;
    const helmet = site.droppedHelmet;
    if (adult && helmet?.parent) {
      const hp = helmet.position.clone();
      site.stageWorker("3", hp.clone().add(new THREE.Vector3(-0.01, 0, 0)));
      await this.waitFor(() => this.arrived(site, "3", hp.clone().add(new THREE.Vector3(-0.01, 0, 0))), 8);
      if (tok !== this.sceneToken) return;
      await this.gesture(w3.obj, "pickUp", site);
      if (!await this.sceneLine(tok, "return.helmet", site)) return;
      site.releaseWorker("3");
    }
    // подходит к 6-му (или через 5 с)
    await this.waitFor(() => {
      const a = site.workers["3"]?.obj, b = site.workers["6"]?.obj;
      return !a || !b || a.position.distanceTo(b.position) < 0.06;
    }, 5);
    this.steps = null;
    if (tok !== this.sceneToken) return;
    this.gesture(site.workers["6"]?.obj, adult ? "highFive" : "cheer", site);
    this.gesture(site.workers["3"]?.obj, adult ? "highFive" : "cheer", site);
    if (!await this.sceneLine(tok, "return.r6", site)) return;
    if (!await this.sceneLine(tok, "return.r3_go", site)) return;
    this.endScene(tok);
  }

  async sceneStay(site, w3) {
    const tok = this.beginScene();
    this.steps = null;
    this.afterGone = null;
    const helmet = site.droppedHelmet;
    if (this.ed === "adult" && helmet?.parent) {
      const p = helmet.position.clone().add(new THREE.Vector3(-0.01, 0, 0));
      site.stageWorker("3", p);
      await this.waitFor(() => this.arrived(site, "3", p), 6);
      if (tok !== this.sceneToken) return;
      await this.gesture(w3.obj, "pickUp", site);
      site.releaseWorker("3");
    }
    if (!await this.sceneLine(tok, "stay.r3", site)) return;
    if (!await this.sceneLine(tok, "stay.boss", site)) return;
    this.endScene(tok);
  }

  // ---------------------------------------------------------------------------
  // кадр
  // ---------------------------------------------------------------------------
  update(dt, { paused, hoursPerSec }) {
    this.hoursPerSec = hoursPerSec;
    this.audio.speedFactor = Math.max(1, hoursPerSec / 0.33);
    this.frameKeys.clear();
    const t = now();
    for (const w of [...this.waiters]) {
      if (w.cond() || t >= w.until) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(); }
    }
    this.audio.update();
    if (this.view) this.bubbles.update(this.view.camera, this.view.canvas, this.view.isVisible);
    if (!this.worlds.length) return;

    // игрушечным фигуркам — жесты (у реалистичных моделей они встроены)
    for (const w of this.worlds) for (const wk of Object.values(w.site.workers)) if (!wk.obj.userData.gesture) installClassicGestures(wk.obj);

    if (this.edAnnounce && t > this.edAnnounce && !this.paused && this.tracking) {
      this.edAnnounce = 0;
      const site = this.worlds[this.focus]?.site;
      const line = this.picker.pick(this.cfg.linesSet, "edition.on");
      if (line && site && !this.sceneActive) this.sayLine(line, { anchor: this.anchorForeman(site), priority: 60, ttl: 4 });
    }
    if (paused || this.paused) return;

    // шаги во время сценки
    if (this.steps) {
      const w = this.steps.site.workers[this.steps.g];
      if (!w) this.steps = null;
      else if ((this.steps.t -= dt) <= 0) {
        this.steps.t = 0.45;
        const p = w.obj.position;
        if (!this.steps.last || this.steps.last.distanceTo(p) > 0.002) this.sfx("steps", w.obj, 0, { gain: 0.8 });
        this.steps.last = p.clone();
      }
    }

    const set = this.cfg.sfxSet;
    let dig = 0, digN = 0, haul = 0, haulN = 0;
    this.worlds.forEach((world, wi) => {
      const site = world.site;
      // слесарь дошёл до машины → начало ремонта, цикл звуков
      for (const w of Object.values(site.workers)) {
        const k = `${wi}:${w.grade}`;
        if (w.atJob && !this.prevAtJob.get(k) && w.job) {
          const mc = w.job;
          this.sfx("repair.start", mc.obj, wi, { kind: mc.kind, minor: true });
          const here = Object.values(site.workers).filter((x) => x.atJob && x.job === mc).map((x) => WHO[x.grade]);
          this.speak("repair.start", { wi, site, mc, p: 0.35, filter: (l) => here.includes(l.who) });
          const lk = `${wi}:${mc.type}:${mc.idx}`;
          if (!this.loops.has(lk)) this.loops.set(lk, { wi, mc, next: t + rnd(0.4, 0.9) });
        }
        this.prevAtJob.set(k, w.atJob);
      }
      // загрузка площадки и мелкие фоновые звуки
      for (const mc of site.machines.values()) {
        const work = mc.state === "work" ? 1 : 0;
        if (mc.kind === "excavator" || mc.kind === "bulldozer") { dig += work; digN++; } else { haul += work; haulN++; }
        if (mc.kind === "bulldozer" && work && wi === this.focus) {
          const dir = Math.cos(mc.obj.rotation.y) >= 0 ? 1 : -1;
          const k = `${wi}:${mc.type}:${mc.idx}`;
          if (this.bullDir.has(k) && this.bullDir.get(k) !== dir && set === "real") this.sfx("amb.clank", mc.obj, wi, { minor: true });
          this.bullDir.set(k, dir);
        }
      }
    });
    this.audio.setLoad({ dig: digN ? dig / digN : 1, haul: haulN ? haul / haulN : 1 });

    // циклы ремонта: не больше 2 слышимых (ближе к камере), в «Двух мирах» — один на мир
    const cam = this.view?.camera;
    const live = [];
    for (const [k, l] of this.loops) {
      const site = this.worlds[l.wi]?.site;
      const busy = site && Object.values(site.workers).some((w) => w.atJob && w.job === l.mc);
      if (!site || l.mc.state !== "fix" || !busy) { this.loops.delete(k); continue; }
      l.d = cam ? cam.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(l.mc.obj.matrixWorld)) : 0;
      live.push(l);
    }
    live.sort((a, b) => a.d - b.d);
    const perWorld = {};
    let audible = 0;
    for (const l of live) {
      if (this.mode === "both" ? (perWorld[l.wi] = (perWorld[l.wi] || 0) + 1) > 1 : ++audible > 2) continue;
      if (t < l.next) continue;
      const ids = set === "real" ? REPAIR[l.mc.kind] : ["repair.hit"];
      const id = ids[Math.floor(Math.random() * ids.length)];
      this.sfx(id, l.mc.obj, l.wi, { kind: l.mc.kind });
      if (set !== "real") this.sfx(id, l.mc.obj, l.wi, { kind: l.mc.kind, delay: 0.16 });   // «тук-тук»
      l.next = t + (id === "repair.grinder" ? rnd(3, 4.5) : rnd(0.9, 1.6));
    }

    // писк заднего хода у работающих самосвалов («Для опытных»)
    if (set === "real" && (this.reverseT -= dt) <= 0) {
      this.reverseT = rnd(10, 20);
      const site = this.worlds[this.focus]?.site;
      const trucks = site ? [...site.machines.values()].filter((m) => m.kind === "truck" && m.state === "work") : [];
      if (trucks.length) this.sfx("amb.reverse", trucks[Math.floor(Math.random() * trucks.length)].obj, this.focus, { minor: true });
    }

    // раз в 5 с: прораб ругается на очередь, 6-й один не справляется
    if ((this.timer5 -= dt) <= 0) {
      this.timer5 = 5;
      const world = this.worlds[this.focus];
      if (world && world.queueLen >= 3) {
        if (world.s.workers.length === 1 && Math.random() < 0.5) this.speak("solo.overload", { wi: this.focus, site: world.site, priority: 38 });
        else this.speak("foreman.rant", { wi: this.focus, site: world.site, priority: 38 });
      }
    }
  }
}
