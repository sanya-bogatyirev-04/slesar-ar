// Модель «Целесообразность увольнения слесаря 3-го разряда» — перенос algorithm/model.py.
// Замкнутая СМО: машины ломаются (Exp), ремонт (Exp) зависит от типа машины и состава бригады.
// Метод 1 — имитация (Монте-Карло, пошаговая симуляция марковского процесса),
// метод 2 — точное решение уравнений Колмогорова (униформизация).

export const DEFAULT_CONFIG = {
  machines: [
    { name: "Экскаватор", kind: "excavator", count: 6, mtbf: 4.0, income: 650, repair_3: 2.0,  repair_6: 1.0, repair_both: 0.25 },
    { name: "Бульдозер",  kind: "bulldozer", count: 3, mtbf: 6.0, income: 450, repair_3: null, repair_6: 2.0, repair_both: 1.5 },
    { name: "Автокран",   kind: "crane",     count: 4, mtbf: 5.0, income: 800, repair_3: null, repair_6: 2.5, repair_both: 1.5 },
    { name: "Самосвал",   kind: "truck",     count: 7, mtbf: 8.0, income: 550, repair_3: 2.5,  repair_6: 1.5, repair_both: 0.75 },
  ],
  wage_6: 100,
  wage_3: 60,
  overhead: 50,
  day_hours: 16,
  work_days_per_year: 247,
  sim_days: 5000,
  seed: 2026,
};

export const EXACT_STATE_LIMIT = 4000;

export const STRATEGIES = [
  { key: "team_fifo",  title: "Бригада 6+3 вместе, очередь FIFO",        workers: ["6", "3"], mode: "team",     discipline: "fifo" },
  { key: "solo6_fifo", title: "Только 6-й разряд (3-й уволен), FIFO",    workers: ["6"],      mode: "solo6",    discipline: "fifo" },
  { key: "team_prio",  title: "Бригада 6+3 вместе, приоритет cμ",        workers: ["6", "3"], mode: "team",     discipline: "priority" },
  { key: "solo6_prio", title: "Только 6-й разряд, приоритет cμ",         workers: ["6"],      mode: "solo6",    discipline: "priority" },
  { key: "split_fifo", title: "Слесари 6 и 3 работают порознь, FIFO",    workers: ["6", "3"], mode: "split",    discipline: "fifo" },
  { key: "adaptive",   title: "Гибкая расстановка (вместе/порознь), cμ", workers: ["6", "3"], mode: "adaptive", discipline: "priority" },
];
export const strategy = (key) => STRATEGIES.find((s) => s.key === key);

export function validate(cfg) {
  const ms = cfg.machines;
  if (!ms || !ms.length) throw new Error("нужен хотя бы один тип машин");
  for (const m of ms) {
    if (!(m.count >= 0) || !(m.mtbf > 0) || !(m.income >= 0))
      throw new Error(`${m.name}: количество ≥ 0, наработка > 0, доход ≥ 0`);
    if (!(m.repair_6 > 0) || !(m.repair_both > 0))
      throw new Error(`${m.name}: 6-й разряд и бригада должны уметь чинить любую машину (время > 0)`);
    if (m.repair_3 != null && !(m.repair_3 > 0))
      throw new Error(`${m.name}: время ремонта 3-м разрядом должно быть > 0 или пусто`);
  }
  if (!(cfg.day_hours > 0)) throw new Error("длительность дня должна быть > 0");
  if (!(cfg.sim_days >= 2)) throw new Error("дней моделирования ≥ 2");
}

// ---------------------------------------------------------------------------
export class Model {
  constructor(cfg) {
    validate(cfg);
    this.cfg = cfg;
    const ms = cfg.machines;
    this.K = ms.length;
    this.TYPES = ms.map((m) => m.name);
    this.KINDS = ms.map((m) => m.kind || "truck");
    this.COUNT = ms.map((m) => Math.round(m.count));
    this.MTBF = ms.map((m) => +m.mtbf);
    this.INCOME = ms.map((m) => +m.income);
    this.REPAIR = {
      3: ms.map((m) => (m.repair_3 == null ? null : +m.repair_3)),
      6: ms.map((m) => +m.repair_6),
      both: ms.map((m) => +m.repair_both),
    };
    this.WAGE = { 6: +cfg.wage_6, 3: +cfg.wage_3 };
    this.OVERHEAD = +cfg.overhead;
    this.DAY = +cfg.day_hours;
    this.YEAR = +cfg.work_days_per_year;
  }

  rate(who, t) {
    const m = this.REPAIR[who][t];
    return m == null ? 0 : 1 / m;
  }
  costPerHour(s) {
    return s.workers.reduce((a, w) => a + this.WAGE[w], 0) + this.OVERHEAD;
  }
  priorityIndex(s, t) {
    return this.INCOME[t] * this.rate(s.mode === "solo6" ? "6" : "both", t);
  }

  // broken — типы сломанных машин в порядке обслуживания.
  // Возвращает [[позиция, интенсивность, исполнители]]; перераспределение
  // в момент события корректно благодаря отсутствию памяти у экспоненты.
  allocate(s, broken) {
    if (!broken.length) return [];
    const together = [[0, this.rate("both", broken[0]), ["6", "3"]]];
    if (s.mode === "team") return together;
    if (s.mode === "solo6") return [[0, this.rate("6", broken[0]), ["6"]]];
    const can3 = (t) => this.REPAIR[3][t] != null;
    if (s.mode === "split") {
      let j3 = -1;
      for (let i = 1; i < broken.length; i++) if (can3(broken[i])) { j3 = i; break; }
      if (j3 < 0) return together;
      return [[0, this.rate("6", broken[0]), ["6"]], [j3, this.rate("3", broken[j3]), ["3"]]];
    }
    // adaptive: максимум скорости снижения убытков Σ c·μ по всем расстановкам
    let bestVal = -1, best = together;
    broken.forEach((t, i) => {
      const v = this.INCOME[t] * this.rate("both", t);
      if (v > bestVal + 1e-12) { bestVal = v; best = [[i, this.rate("both", t), ["6", "3"]]]; }
    });
    broken.forEach((ti, i) => broken.forEach((tj, j) => {
      if (i !== j && can3(tj)) {
        const v = this.INCOME[ti] * this.rate("6", ti) + this.INCOME[tj] * this.rate("3", tj);
        if (v > bestVal + 1e-12) {
          bestVal = v;
          best = [[i, this.rate("6", ti), ["6"]], [j, this.rate("3", tj), ["3"]]];
        }
      }
    }));
    return best;
  }

  orderQueue(s, queue) {
    if (s.discipline === "fifo") return queue;
    const pi = this.INCOME.map((_, t) => this.priorityIndex(s, t));
    return [...queue].sort((a, b) => pi[b.type] - pi[a.type] || a.t - b.t);
  }

  // ----- Метод 1. Имитация одного дня -------------------------------------
  // trace=true — возвращает журнал событий с номерами конкретных машин (для анимации)
  simulateDay(s, rng, trace = false) {
    const K = this.K, DAY = this.DAY;
    const working = this.COUNT.map((c, t) => Array.from({ length: c }, (_, i) => i)); // номера внутри типа
    let queue = [];                   // {type, idx, t}
    const idle = new Array(K).fill(0);
    const busy = { 6: 0, 3: 0 };
    const lam = this.MTBF.map((m) => 1 / m);
    const log = trace ? [] : null;
    let t = 0;

    for (;;) {
      const ordered = this.orderQueue(s, queue);
      const alloc = this.allocate(s, ordered.map((q) => q.type));
      if (trace) {
        log.push({
          t, kind: "alloc",
          jobs: alloc.map(([pos, , who]) => ({ type: ordered[pos].type, idx: ordered[pos].idx, who })),
          broken: queue.map((q) => ({ type: q.type, idx: q.idx })),
        });
      }
      const rBreak = working.map((w, i) => w.length * lam[i]);
      let total = 0;
      for (const r of rBreak) total += r;
      for (const a of alloc) total += a[1];
      const dt = total > 0 ? -Math.log(1 - rng()) / total : Infinity;
      const step = Math.min(dt, DAY - t);
      for (const q of queue) idle[q.type] += step;
      for (const a of alloc) for (const w of a[2]) busy[w] += step;
      t += step;
      if (t >= DAY) break;

      let u = rng() * total;
      let done = false;
      for (let i = 0; i < K && !done; i++) {
        if (u < rBreak[i]) {
          const k = Math.floor(rng() * working[i].length);
          const idx = working[i].splice(k, 1)[0];
          queue.push({ type: i, idx, t });
          if (trace) log.push({ t, kind: "break", type: i, idx });
          done = true;
        } else u -= rBreak[i];
      }
      if (!done) {
        for (const [pos, r, who] of alloc) {
          if (u < r) {
            const item = ordered[pos];
            queue = queue.filter((q) => q !== item);
            working[item.type].push(item.idx);
            if (trace) log.push({ t, kind: "fix", type: item.type, idx: item.idx, who, down: t - item.t });
            break;
          }
          u -= r;
        }
      }
    }
    return { idle, busy, log };
  }

  simulate(s, days, seed) {
    const rng = mulberry32(seed);
    const K = this.K;
    const sum = new Array(K).fill(0);
    const loss = new Float64Array(days);
    const busy = { 6: 0, 3: 0 };
    for (let d = 0; d < days; d++) {
      const r = this.simulateDay(s, rng);
      let l = 0;
      for (let i = 0; i < K; i++) { sum[i] += r.idle[i]; l += r.idle[i] * this.INCOME[i]; }
      loss[d] = l;
      busy[6] += r.busy[6]; busy[3] += r.busy[3];
    }
    const mean = loss.reduce((a, b) => a + b, 0) / days;
    const sd = Math.sqrt(loss.reduce((a, b) => a + (b - mean) ** 2, 0) / (days - 1));
    return {
      idle: sum.map((x) => x / days),
      lossMean: mean,
      lossCI: (1.96 * sd) / Math.sqrt(days),
      busy: { 6: busy[6] / days, 3: busy[3] / days },
      losses: loss,
    };
  }

  // ----- Метод 2. Точное решение уравнений Колмогорова ---------------------
  nStates() {
    return this.COUNT.reduce((a, c) => a * (c + 1), 1);
  }

  kolmogorov(s) {
    const K = this.K, C = this.COUNT, n = this.nStates();
    const mult = new Array(K);
    let m = 1;
    for (let i = K - 1; i >= 0; i--) { mult[i] = m; m *= C[i] + 1; }
    const decode = (code) => mult.map((mm, i) => Math.floor(code / mm) % (C[i] + 1));
    const pi = this.INCOME.map((_, t) => this.priorityIndex(s, t));
    const byPrio = [...Array(K).keys()].sort((a, b) => pi[b] - pi[a]);

    // разреженная запись генератора: переходы из каждого состояния
    const from = [], to = [], rate = [];
    const exitRate = new Float64Array(n);
    const states = [];
    for (let code = 0; code < n; code++) {
      const st = decode(code);
      states.push(st);
      for (let t = 0; t < K; t++) {
        const r = (C[t] - st[t]) / this.MTBF[t];
        if (r > 0) { from.push(code); to.push(code + mult[t]); rate.push(r); exitRate[code] += r; }
      }
      const broken = [];
      for (const t of byPrio) for (let k = 0; k < st[t]; k++) broken.push(t);
      for (const [pos, r] of this.allocate(s, broken)) {
        const t = broken[pos];
        from.push(code); to.push(code - mult[t]); rate.push(r); exitRate[code] += r;
      }
    }
    let lam = 0;
    for (const e of exitRate) lam = Math.max(lam, e);
    lam *= 1.0001;
    const pr = Float64Array.from(rate, (r) => r / lam);
    const stay = Float64Array.from(exitRate, (e) => 1 - e / lam);
    const stepP = (v) => {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = v[i] * stay[i];
      for (let k = 0; k < pr.length; k++) w[to[k]] += v[from[k]] * pr[k];
      return w;
    };

    // ∫_0^T p(t)dt = (1/Λ) Σ_k P{N(ΛT) > k} · p0·P^k
    const T = this.DAY, mu = lam * T;
    const kmax = Math.ceil(mu + 10 * Math.sqrt(mu) + 50);
    let v = new Float64Array(n); v[0] = 1;
    const acc = new Float64Array(n);
    let logp = -mu, cdf = Math.exp(logp);
    for (let k = 0; k < kmax; k++) {
      const tail = 1 - cdf;
      for (let i = 0; i < n; i++) acc[i] += tail * v[i];
      v = stepP(v);
      logp += Math.log(mu) - Math.log(k + 1);
      cdf += Math.exp(logp);
    }
    const idle = new Array(K).fill(0);
    for (let i = 0; i < n; i++) for (let t = 0; t < K; t++) idle[t] += (acc[i] / lam) * states[i][t];
    return { idle, lossMean: idle.reduce((a, x, t) => a + x * this.INCOME[t], 0), states: n };
  }

  economics(s, idle) {
    const potential = this.INCOME.reduce((a, c, i) => a + c * this.COUNT[i] * this.DAY, 0);
    const lost = idle.reduce((a, x, i) => a + x * this.INCOME[i], 0);
    const earned = potential - lost;
    const staff = this.costPerHour(s) * this.DAY;
    return { potential, earned, lost, staff, result: earned - lost - staff, resultAlt: earned - staff };
  }

  // Полный расчёт всех стратегий; onProgress(i, n) — для индикатора
  async runAll(days, seed, onProgress) {
    const exactOk = this.nStates() <= EXACT_STATE_LIMIT;
    const out = {};
    for (let i = 0; i < STRATEGIES.length; i++) {
      const s = STRATEGIES[i];
      onProgress && onProgress(i, STRATEGIES.length, s);
      await new Promise((r) => setTimeout(r, 0));
      const sim = this.simulate(s, days, seed);
      const exact = s.discipline === "priority" && exactOk ? this.kolmogorov(s) : null;
      const idle = exact ? exact.idle : sim.idle;
      out[s.key] = { s, sim, exact, econ: this.economics(s, idle) };
    }
    onProgress && onProgress(STRATEGIES.length, STRATEGIES.length);
    const verdict = (a, b) => {
      const d = out[a].econ.result - out[b].econ.result;
      return {
        saved: out[a].econ.staff - out[b].econ.staff,
        extraLoss: out[b].econ.lost - out[a].econ.lost,
        delta: d, deltaYear: d * this.YEAR,
        deltaAlt: out[a].econ.resultAlt - out[b].econ.resultAlt,
        fire: d < 0,
      };
    };
    return { results: out, main: verdict("team_fifo", "solo6_fifo"), prio: verdict("team_prio", "solo6_prio"), exactOk };
  }
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
