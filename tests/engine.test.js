const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, STATIONS } = require('../engine');

test('all stations begin with normal local readings and no predictive alert', () => {
  const sim = new Simulation();
  assert.equal(sim.states.length, 4);
  assert.ok(sim.states.every(s => s.status === 'normal' && s.early === null));
});

test('a flash flood propagates in order and warns D before its local rise', () => {
  const sim = new Simulation(); sim.launch('flash');
  const peaks = STATIONS.map(() => ({ level: 0, time: 0 }));
  let firstDEarly = null, firstDRise = null;
  for (let i = 0; i < 1200; i++) {
    sim.step();
    sim.states.forEach((s, j) => { if (s.level > peaks[j].level) peaks[j] = { level: s.level, time: sim.time }; });
    const d = sim.states[3];
    if (d.early && firstDEarly === null) { firstDEarly = sim.time;assert.equal(d.status, 'normal');assert.ok(d.level < 20);assert.ok(d.early.eta > 80); }
    if (d.level > d.base + 12 && firstDRise === null) firstDRise = sim.time;
  }
  assert.ok(firstDEarly !== null && firstDRise !== null && firstDEarly < firstDRise);
  assert.deepEqual(peaks.map(p => p.time), [27, 327, 677, 1052]);
  assert.ok(sim.states.every(s => s.status === 'normal' && !s.early));
  assert.ok(sim.events.some(e => e.type === 'danger'));
});

test('forecast countdown uses upstream observations and does not exist before launch or rise', () => {
  const sim = new Simulation();sim.step(30);assert.ok(sim.states.every(s => !s.early));
  sim.launch('flash');sim.step(2);assert.ok(sim.states.every(s => !s.early));
  sim.step(10);const eta = sim.states[3].early.eta;sim.step(4);assert.equal(sim.states[3].early.eta, eta - 4);
});

test('gradual scenario triggers warning but no danger and two waves produce distinct rises', () => {
  const gradual = new Simulation();gradual.launch('gradual');gradual.step(1200);
  assert.ok(gradual.events.some(e => e.type === 'warning'));
  assert.ok(!gradual.events.some(e => e.type === 'danger'));
  const double = new Simulation();double.launch('double');double.step(1200);
  assert.equal(double.events.filter(e => e.type === 'rise' && e.station === 'A').length, 2);
});

test('different playback increments produce the same simulated state', () => {
  const a = new Simulation(), b = new Simulation();a.launch();b.launch();
  for (let i = 0; i < 100; i++) a.step();
  for (let i = 0; i < 20; i++) b.step(5);
  assert.deepEqual(a.states, b.states);assert.deepEqual(a.events, b.events);
});

test('reset clears waves, detections and past alerts; history stays bounded', () => {
  const sim = new Simulation();sim.launch();sim.step(1200);
  assert.ok(sim.history.length <= 241);assert.equal(sim.waves.length, 0);
  sim.reset();assert.equal(sim.time, 0);assert.equal(sim.waves.length, 0);assert.equal(sim.detections.length, 0);assert.equal(sim.events.length, 1);assert.ok(sim.states.every(s => s.status === 'normal' && !s.early));
});

test('travel time uses metres divided by m/s and doubles when velocity halves', () => {
  const fast = new Simulation({ velocity: 4 }), slow = new Simulation({ velocity: 2 });
  assert.equal(fast.travelTime(0, 1), 300);
  assert.equal(fast.travelTime(1, 2), 350);
  assert.ok(Math.abs(fast.travelTime(2, 3) - 375) < 1e-9);
  assert.equal(slow.travelTime(0, 1), 600);
  fast.launch();slow.launch();fast.step(15);slow.step(15);
  assert.equal(slow.states[1].early.arrival - fast.states[1].early.arrival, 300);
  assert.equal(fast.states[1].early.velocity, 4);
});

test('reverse flow warns A from D and physically arrives D, C, B, A', () => {
  const sim = new Simulation({ direction: 'reverse' });sim.launch();sim.step(12);
  assert.equal(sim.states[0].early.source, 'D');
  assert.equal(sim.states[3].early, null);
  assert.equal(sim.states[0].status, 'normal');
  sim.step(1188);
  const rises = sim.events.filter(e => e.type === 'rise').reverse();
  assert.deepEqual(rises.map(e => e.station), ['D', 'C', 'B', 'A']);
  assert.equal(sim.observedDirection, 'reverse');
  assert.ok(sim.states.every(s => !s.early));
});

test('flat terrain keeps direction unknown with one observation, then infers either direction', () => {
  for (const direction of ['forward', 'reverse']) {
    const sim = new Simulation({ direction, terrain: 'flat' });
    assert.equal(sim.observedDirection, 'unknown');sim.launch();sim.step(20);
    assert.equal(sim.observedDirection, 'unknown');assert.equal(sim.observation, null);
    assert.ok(sim.states.filter(s => s.early).every(s => s.early.conditional));
    sim.step(390);
    assert.equal(sim.observedDirection, direction);
    assert.ok(Math.abs(sim.observation.velocity - 4) < .1);
    assert.ok(sim.states.filter(s => s.early).every(s => !s.early.conditional));
    assert.equal(sim.history.find(h => h.time === 200).direction, 'unknown');
  }
});

test('slow waves retain detections until next station instead of expiring after three minutes', () => {
  const sim = new Simulation({ velocity: .5 });sim.launch();sim.step(400);
  assert.ok(sim.states[1].early.eta > 1900);
  sim.step(8100);
  assert.ok(sim.events.some(e => e.station === 'D' && e.type === 'rise'));
  assert.ok(sim.states.every(s => s.status === 'normal' && !s.early));
  assert.equal(sim.active, false);
});

test('configuration changes reset observations and refuse impossible speeds', () => {
  const sim = new Simulation();sim.launch();sim.step(400);assert.ok(sim.observation);
  sim.configure({ velocity: 2, direction: 'reverse', terrain: 'flat' });
  assert.equal(sim.observation, null);assert.equal(sim.time, 0);assert.equal(sim.observedDirection, 'unknown');
  for (const velocity of [0, -1, NaN, Infinity, 16]) assert.throws(() => sim.configure({ velocity }));
  assert.equal(sim.velocity, 2);
});

test('overlapping launches are blocked to keep wave matching interpretable', () => {
  const sim = new Simulation();assert.equal(sim.launch(), true);assert.equal(sim.launch(), false);
  sim.step(1200);assert.equal(sim.launch(), true);assert.equal(sim.observation, null);
});
