// Реплики персонажей. Данные — js/lines.json (один источник и для субтитров, и для
// заранее записанной озвучки tools/make_voices.ps1). Здесь — только выбор: перемешанный
// «мешок» на категорию, без повторов, пока мешок не опустеет.
let DATA = null;

export async function loadLines() {
  if (!DATA) DATA = await fetch("js/lines.json").then((r) => r.json());
  return DATA;
}
export const linesData = () => DATA;

export class LinePicker {
  constructor() { this.bags = new Map(); this.last = new Map(); }
  reset() { this.bags.clear(); this.last.clear(); }

  has(set, cat) { return !!DATA?.[set]?.[cat]?.length; }

  // filter(line) → можно ли говорить эту реплику (например, 3-го нет на площадке)
  pick(set, cat, filter = null) {
    const pool = DATA?.[set]?.[cat];
    if (!pool?.length) return null;
    const key = set + ":" + cat;
    let bag = this.bags.get(key);
    if (!bag || !bag.length) {
      bag = pool.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.length > 1 && bag[bag.length - 1] === this.last.get(key)) bag.unshift(bag.pop());   // новый мешок не с последней фразы
      this.bags.set(key, bag);
    }
    for (let k = bag.length - 1; k >= 0; k--) {
      const line = pool[bag[k]];
      if (filter && !filter(line)) continue;
      bag.splice(k, 1);
      this.last.set(key, pool.indexOf(line));
      return line;
    }
    // в мешке не осталось подходящих — берём любую подходящую из пула
    const ok = pool.filter((l) => !filter || filter(l));
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }
}

export function role(who) {
  return DATA?.roles?.[who] || { label: who, voice: "Pavel", pitch: 1, rate: 1 };
}
