// «Мир» = модель + стратегия + площадка. Проигрывает журнал событий дня, посчитанный
// той же имитационной моделью, и ведёт денежные счётчики (кусочно-постоянные ставки).
import { mulberry32, strategy } from "./model.js";

export class World {
  constructor(model, strategyKey, site, seed) {
    this.model = model;
    this.site = site;
    this.rng = mulberry32(seed);
    this.history = [];
    this.day = 0;
    this.setStrategy(strategyKey);
  }

  setStrategy(key) {
    this.s = strategy(key);
    this.site.setWorkers(this.s.workers);
    this.startDay();
  }

  startDay() {
    const m = this.model;
    this.day += 1;
    this.t = 0;
    this.log = m.simulateDay(this.s, this.rng, true).log;
    this.ptr = 0;
    this.broken = new Array(m.K).fill(0);
    this.money = { income: 0, loss: 0, staff: 0 };
    this.craneWork = 0;
    this.queueLen = 0;
    this.finished = false;
    this.site.resetDay();
  }

  rates() {
    const m = this.model;
    let inc = 0, loss = 0, cranes = 0;
    for (let t = 0; t < m.K; t++) {
      inc += (m.COUNT[t] - this.broken[t]) * m.INCOME[t];
      loss += this.broken[t] * m.INCOME[t];
      if (m.KINDS[t] === "crane") cranes += m.COUNT[t] - this.broken[t];
    }
    return { inc, loss, staff: m.costPerHour(this.s), cranes };
  }

  integrate(dt) {
    if (dt <= 0) return;
    const r = this.rates();
    this.money.income += r.inc * dt;
    this.money.loss += r.loss * dt;
    this.money.staff += r.staff * dt;
    this.craneWork += r.cranes * dt;
  }

  apply(ev) {
    if (ev.kind === "break") { this.broken[ev.type]++; this.site.onBreak(ev.type, ev.idx); }
    else if (ev.kind === "fix") { this.broken[ev.type]--; this.site.onFix(ev.type, ev.idx); }
    else if (ev.kind === "alloc") { this.site.assign(ev.jobs); this.queueLen = ev.broken.length; }
  }

  // hours — на сколько часов модели продвинуться
  advance(hours) {
    if (this.finished) return;
    const DAY = this.model.DAY;
    const target = Math.min(DAY, this.t + hours);
    while (this.ptr < this.log.length && this.log[this.ptr].t <= target) {
      const ev = this.log[this.ptr++];
      this.integrate(ev.t - this.t);
      this.t = ev.t;
      this.apply(ev);
    }
    this.integrate(target - this.t);
    this.t = target;
    const m = this.model;
    const nCranes = m.KINDS.reduce((a, k, t) => a + (k === "crane" ? m.COUNT[t] : 0), 0);
    this.site.setBuildingProgress(nCranes ? this.craneWork / (nCranes * DAY) : 0);
    if (this.t >= DAY) {
      this.finished = true;
      this.history.push(this.summary());
    }
  }

  summary() {
    const { income, loss, staff } = this.money;
    return { day: this.day, income, loss, staff, result: income - loss - staff };
  }

  averages() {
    const h = this.history;
    if (!h.length) return null;
    const avg = (k) => h.reduce((a, x) => a + x[k], 0) / h.length;
    return { days: h.length, income: avg("income"), loss: avg("loss"), staff: avg("staff"), result: avg("result") };
  }
}
