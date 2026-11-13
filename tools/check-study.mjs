import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Model, DEFAULT_CONFIG, STRATEGIES, mulberry32 } from '../js/model.js';
import { studyConfig, runStudy } from '../js/study.js';

// Counting must preserve every existing random trajectory, not just its mean.
const previous = execFileSync('git', ['show', '214e472de61496d7160ad7e6988223fd25a57bb9:js/model.js'], {encoding:'utf8'});
const old = await import('data:text/javascript;base64,' + Buffer.from(previous).toString('base64'));
for (const strategy of STRATEGIES) for (let seed = 0; seed < 40; seed++) {
  const day = new Model(DEFAULT_CONFIG).simulateDay(strategy, mulberry32(seed), true);
  const before = new old.Model(DEFAULT_CONFIG).simulateDay(strategy, mulberry32(seed), true);
  const {failures, ...same} = day;
  assert.deepEqual(same, before);
  for (let i=0;i<failures.length;i++) assert.equal(failures[i], day.log.filter(e => e.kind==='break' && e.type===i).length);
}
for (const hours of [6,5,4]) {
  const cfg = studyConfig(DEFAULT_CONFIG, hours);
  assert.equal(cfg.machines[1].mtbf, hours);
  cfg.machines[1].mtbf = 6;
  assert.deepEqual(cfg, DEFAULT_CONFIG);
}
const a = await runStudy(DEFAULT_CONFIG,{days:1000});
assert.deepEqual(a, await runStudy(DEFAULT_CONFIG,{days:1000}));
for (const r of a.rows) {
  const discrepancy = Math.abs(r.stats.bulldozerFailures.mean - r.lambda*r.stats.bulldozerUptime.mean);
  assert(discrepancy < 0.3, 'event counts agree with integrated working-time failure rate');
  assert(r.stats.allFailures.mean >= r.stats.bulldozerFailures.mean);
  if(r.hours===6) assert.equal(r.delta.result.mean,0);
}
const zero = structuredClone(DEFAULT_CONFIG); zero.machines.forEach(m=>m.count=0);
for(const r of (await runStudy(zero,{days:2})).rows) {
  assert.equal(r.stats.allFailures.mean,0);
  assert.equal(r.stats.result.mean,-r.staff);
}
assert.equal(DEFAULT_CONFIG.machines[1].mtbf,6);
console.log('PASS: 240 unchanged V1 trajectories; event counters; isolated scenarios; reproducibility; failure-rate identity; empty fleet.');
