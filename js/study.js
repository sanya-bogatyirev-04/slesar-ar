// V2: only the bulldozers' mean operating time changes. Repair rates are unchanged.
import { Model, DEFAULT_CONFIG, strategy, mulberry32 } from "./model.js";

export const STUDY_TIMES = [6, 5, 4];
export function studyConfig(base = DEFAULT_CONFIG, hours = 5) {
  if (!STUDY_TIMES.includes(hours)) throw new Error("Выберите 6, 5 или 4 часа");
  const cfg = structuredClone(base);
  const bulldozers = cfg.machines.filter((m) => m.kind === "bulldozer");
  if (!bulldozers.length) throw new Error("В v2 нужен хотя бы один тип бульдозеров");
  bulldozers.forEach((m) => { m.mtbf = hours; });
  return cfg;
}

class Moments {
  constructor() { this.n = 0; this.mean = 0; this.m2 = 0; }
  add(x) { this.n++; const d = x - this.mean; this.mean += d / this.n; this.m2 += d * (x - this.mean); }
  get ci95() { return this.n > 1 ? 1.96 * Math.sqrt(this.m2 / (this.n - 1) / this.n) : 0; }
  result() { return { mean: this.mean, ci95: this.ci95 }; }
}
const FIELDS = ["bulldozerFailures", "allFailures", "bulldozerIdle", "bulldozerUptime", "result", "lost", "earned"];
const moments = () => Object.fromEntries(FIELDS.map((k) => [k, new Moments()]));
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function runStudy(base, { days = 10000, seed = 2026, discipline = "fifo", onProgress } = {}) {
  if (!Number.isInteger(days) || days < 2 || days > 100000) throw new Error("Число смен должно быть целым: от 2 до 100 000");
  if (!["fifo", "priority"].includes(discipline)) throw new Error("Неизвестная очередь ремонта");
  const rows = [], baselines = new Map();
  const strategies = ["team", "solo6"].map((key) => strategy(key + (discipline === "fifo" ? "_fifo" : "_prio")));
  let done = 0;
  for (const hours of STUDY_TIMES) for (const s of strategies) {
    const cfg = studyConfig(base, hours), model = new Model(cfg);
    const bulldozerTypes = cfg.machines.flatMap((m, i) => m.kind === "bulldozer" ? [i] : []);
    const count = bulldozerTypes.reduce((sum, i) => sum + model.COUNT[i], 0);
    const stats = moments(), delta = moments();
    const samples = hours === 6 ? [] : baselines.get(s.key);
    for (let d = 0; d < days; d++) {
      // Reproducible independent daily streams, with matched seeds across scenarios.
      // No extra draws are used for counting failures: V1 trajectories stay unchanged.
      const rng = mulberry32((seed ^ Math.imul(d + 1, 0x9e3779b1)) >>> 0);
      const day = model.simulateDay(s, rng);
      const econ = model.economics(s, day.idle);
      const idle = bulldozerTypes.reduce((sum, i) => sum + day.idle[i], 0);
      const sample = {
        bulldozerFailures: bulldozerTypes.reduce((sum, i) => sum + day.failures[i], 0),
        allFailures: day.failures.reduce((sum, n) => sum + n, 0),
        bulldozerIdle: idle, bulldozerUptime: count * model.DAY - idle,
        result: econ.result, lost: econ.lost, earned: econ.earned,
      };
      for (const k of FIELDS) {
        stats[k].add(sample[k]);
        delta[k].add(sample[k] - (hours === 6 ? sample[k] : samples[d][k]));
      }
      if (hours === 6) samples.push(sample);
      if ((d + 1) % 200 === 0) { onProgress?.((done + (d + 1) / days) / 6); await pause(); }
    }
    if (hours === 6) baselines.set(s.key, samples);
    rows.push({ hours, lambda: 1 / hours, strategy: s.key, label: s.mode === "team" ? "Бригада 6+3" : "Только 6-й",
      count, staff: model.costPerHour(s) * model.DAY,
      stats: Object.fromEntries(FIELDS.map((k) => [k, stats[k].result()])),
      delta: Object.fromEntries(FIELDS.map((k) => [k, delta[k].result()])),
    });
    done++; onProgress?.(done / 6);
  }
  return { rows, days, seed, discipline, config: structuredClone(base), timeUnit: "16-hour day (or configured day_hours)" };
}

export function studyCSV(result) {
  const rows = [["T_bulldozer_h", "lambda_per_operating_h", "strategy", "days", "seed", "bulldozer_failures_mean", "bulldozer_failures_CI95", "all_failures_mean", "bulldozer_idle_machine_h", "result_RUB_mean", "result_CI95", "delta_result_vs_6h", "delta_CI95"]];
  for (const r of result.rows) rows.push([r.hours, r.lambda, r.strategy, result.days, result.seed, r.stats.bulldozerFailures.mean, r.stats.bulldozerFailures.ci95, r.stats.allFailures.mean, r.stats.bulldozerIdle.mean, r.stats.result.mean, r.stats.result.ci95, r.delta.result.mean, r.delta.result.ci95]);
  return "\uFEFF" + rows.map((row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(";")).join("\r\n");
}
