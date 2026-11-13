import { studyCSV } from './study.js';
const fmt = (x, d = 2) => Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d });
export function studyHTML(result) {
  const cell = (s, d = 2) => `${fmt(s.mean, d)} ± ${fmt(s.ci95, d)}`;
  const rows = result.rows.map(r => `<tr><td data-label="Наработка / λ">${r.hours} ч / ${fmt(r.lambda, 4)}</td><td data-label="Слесари">${r.label}</td><td data-label="Отказы бульдозеров">${cell(r.stats.bulldozerFailures)}</td><td data-label="Отказы всего парка">${cell(r.stats.allFailures)}</td><td data-label="Результат, ₽">${cell(r.stats.result, 0)}</td><td data-label="Разница к 6 ч, ₽">${cell(r.delta.result, 0)}</td></tr>`).join('');
  return `<p>Среднее за смену ${result.config.day_hours} ч; ${fmt(result.days, 0)} независимых смен на сценарий. Очередь: ${result.discipline === 'fifo' ? 'FIFO' : 'приоритет cμ'}. Seed: ${result.seed}. Знак ± — половина 95% доверительного интервала среднего.</p><table class="res-table"><thead><tr><th>T / λ, ч⁻¹</th><th>Слесари</th><th>Отказы бульдозеров</th><th>Отказы всего парка</th><th>Результат, ₽</th><th>Δ к 6 ч, ₽</th></tr></thead><tbody>${rows}</tbody></table>${studyChart(result, 'bulldozerFailures', 'Отказы бульдозеров за смену')}${studyChart(result, 'result', 'Экономический результат всего парка, ₽/смену')}<p>Результат рассчитан по формуле исходной работы: потенциальный доход − 2 × потери от простоя − содержание слесарей. Потери здесь учитываются и как недополученный доход, и как отдельный штраф. Остальные параметры во всех трёх сценариях одинаковы. Каждая смена начинается с исправным парком; повторные отказы учитываются.</p>`;
}
export function studyChart(result, field, title) {
  const vals = result.rows.map(r => r.stats[field].mean);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals), span = hi - lo;
  const y = v => 190 - (v - lo) / span * 140;
  const bars = result.rows.map((r, i) => {
    const v = r.stats[field].mean, x = 64 + i * 85;
    return `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="48" height="${Math.max(1, Math.abs(y(v)-y(0)))}" rx="3" fill="${i % 2 ? '#e97539' : '#2188a5'}"/><text x="${x+24}" y="${v >= 0 ? y(v)-7 : y(v)+16}" text-anchor="middle">${fmt(v, field === 'result' ? 0 : 2)}</text><text x="${x+24}" y="215" text-anchor="middle">${r.hours} ч</text><text x="${x+24}" y="235" text-anchor="middle">${i%2 ? '6-й' : '6+3'}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="study-chart" viewBox="0 0 620 250" role="img" aria-label="${title}"><title>${title}</title><style>text{font:13px sans-serif;fill:#263445}</style><rect width="620" height="250" rx="12" fill="#f4f7fa"/><text x="20" y="25">${title}</text><line x1="45" x2="590" y1="${y(0)}" y2="${y(0)}" stroke="#aaa"/>${bars}</svg>`;
}
export function setupStudy({ getState, hold, release }) {
  const panel = document.querySelector('#panel-study'), output = document.querySelector('#study-output');
  let worker, result;
  function stop() { worker?.terminate(); worker = null; document.querySelector('#study-run').disabled = false; }
  function run() {
    stop(); result = null;
    document.querySelector('#study-export').disabled = true;
    document.querySelector('#study-run').disabled = true;
    output.textContent = 'Расчёт… 0%';
    try {
      worker = new Worker(new URL('./study-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({data}) => {
        if (data.error) { output.textContent = data.error; stop(); }
        else if (data.result) { result = data.result; output.innerHTML = studyHTML(result); document.querySelector('#study-export').disabled = false; stop(); }
        else output.textContent = `Расчёт… ${Math.round(data.progress * 100)}%`;
      };
      worker.onerror = () => { output.textContent = 'Не удалось выполнить расчёт. Повторите попытку.'; stop(); };
      const state = getState();
      worker.postMessage({config: state.cfg, options: { days: Number(document.querySelector('#study-days').value), seed: state.cfg.seed ?? 2026, discipline: state.discipline }});
    } catch(e) { output.textContent = e.message; stop(); }
  }
  document.querySelectorAll('[data-open-study]').forEach(b => b.onclick = () => { panel.classList.remove('hidden'); hold(); run(); });
  document.querySelector('#study-run').onclick = run;
  document.querySelector('#study-export').onclick = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([studyCSV(result)], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'comparison-v2.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { close() { stop(); release(); } };
}
