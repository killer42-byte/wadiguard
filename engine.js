(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WadiEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATIONS = [
    { id: 'A', name: 'طرف الوادي A', km: 0, base: 22, color: '#42d8b1', x: 277, y: 94 },
    { id: 'B', name: 'المجرى الأوسط', km: 1.2, base: 19, color: '#69a9f8', x: 401, y: 222 },
    { id: 'C', name: 'نقطة العبور', km: 2.6, base: 16, color: '#b19afa', x: 332, y: 351 },
    { id: 'D', name: 'طرف المنطقة السكنية', km: 4.1, base: 14, color: '#f2bd64', x: 510, y: 468 }
  ];
  const SCENARIOS = {
    gradual: { label: 'ارتفاع تدريجي', amplitude: 66, width: 34 },
    flash: { label: 'موجة سيل مفاجئة', amplitude: 144, width: 25 },
    double: { label: 'موجتان متتاليتان', amplitude: 108, width: 27 }
  };
  const WARNING = 65, DANGER = 110;
  class Simulation {
    constructor(options = {}) {
      this.configure(options);
    }
    configure({ velocity = 4, direction = 'forward', terrain = 'slope' } = {}) {
      if (!Number.isFinite(velocity) || velocity < 0.5 || velocity > 15) throw new Error('Velocity must be between 0.5 and 15 m/s');
      if (!['forward', 'reverse'].includes(direction)) throw new Error('Invalid direction');
      if (!['slope', 'flat'].includes(terrain)) throw new Error('Invalid terrain');
      this.velocity = velocity; this.direction = direction; this.terrain = terrain;
      this.reset();
    }
    get sourceIndex() { return this.direction === 'forward' ? 0 : 3; }
    get observedDirection() { return this.observation?.direction || (this.terrain === 'slope' ? this.direction : 'unknown'); }
    get forecastSpeed() { return this.observation?.velocity || this.velocity; }
    distance(a, b) { return Math.abs(STATIONS[a].km * 1000 - STATIONS[b].km * 1000); }
    travelTime(a, b, velocity = this.velocity) { return this.distance(a, b) / velocity; }
    get active() { return this.waves.some(w => this.time < w.start + this.travelTime(0, 3) + w.width * 2 + 15); }
    reset() {
      this.time = 0; this.waves = []; this.events = []; this.history = [];
      this.sequence = 0; this.previous = {}; this.detections = [];
      this.firstArrivals = {}; this.observation = null;
      for (let t = -90; t <= 0; t += 2) this.history.push({ time: t, levels: STATIONS.map((s, i) => this.level(i, t)), waveVelocity: this.velocity, waveBasis: 'assumed', direction: this.observedDirection, directionBasis: this.terrain === 'flat' ? 'unknown' : 'configured' });
      this.states = this.evaluate();
      this.log('system', null, 'الشبكة جاهزة', 'تم توصيل المحطات الأربع. جميع القراءات في النطاق الطبيعي.');
    }
    level(index, time = this.time) {
      const s = STATIONS[index];
      let level = s.base + 0.65 * Math.sin(time * 0.12 + index * 1.7);
      for (const wave of this.waves) {
        const elapsed = time - wave.start - this.travelTime(this.sourceIndex, index);
        const order = Math.abs(index - this.sourceIndex);
        if (elapsed > 0 && elapsed < wave.width * 2) level += wave.amplitude * (1 - order * 0.065) * Math.sin(Math.PI * elapsed / (wave.width * 2)) ** 2;
      }
      return Math.max(0, level);
    }
    launch(scenario = 'flash') {
      const setting = SCENARIOS[scenario];
      if (!setting) throw new Error('Unknown scenario');
      if (this.active) return false;
      this.detections = []; this.firstArrivals = {}; this.observation = null;
      this.waves.push({ ...setting, start: this.time + 2 });
      if (scenario === 'double') this.waves.push({ ...setting, amplitude: 135, start: this.time + 48 });
      const source = STATIONS[this.sourceIndex].id;
      this.log('simulation', source, 'إطلاق تدفق تجريبي', `${setting.label} من ${source} بسرعة مفترضة ${this.velocity} م/ث. ${this.terrain === 'flat' ? 'مجرى مستوٍ: الاتجاه غير محسوم حتى رصد التسلسل بين محطتين.' : 'اتجاه التدفق محدد في إعدادات التجربة.'}`);
      return true;
    }
    log(type, station, title, message) {
      this.events.unshift({ id: ++this.sequence, time: this.time, type, station, title, message });
      if (this.events.length > 250) this.events.length = 250;
    }
    evaluate() {
      const states = STATIONS.map((s, i) => {
        const level = this.level(i);
        const rate = (level - this.level(i, this.time - 5)) * 12;
        const status = level >= DANGER ? 'danger' : level >= WARNING ? 'warning' : 'normal';
        return { ...s, level, rate, status, early: null };
      });
      states.forEach((s, i) => {
        const prev = this.previous[s.id];
        if (s.level - s.base > 12 && s.rate > 6 && !prev?.rising) {
          this.detections.push({ index: i, time: this.time, severity: 'warning' });
          if (this.firstArrivals[i] === undefined) this.firstArrivals[i] = this.time;
          this.log('rise', s.id, `رُصد ارتفاع في المحطة ${s.id}`, `سرعة الارتفاع ${s.rate.toFixed(1)} سم/دقيقة؛ متابعة المحطات التالية.`);
        }
        if (s.status !== 'normal' && prev?.status !== s.status) this.log(s.status, s.id, s.status === 'danger' ? `منسوب خطر في المحطة ${s.id}` : `تحذير في المحطة ${s.id}`, `المنسوب المقاس ${s.level.toFixed(0)} سم؛ حد ${s.status === 'danger' ? 'الخطر 110' : 'التحذير 65'} سم.`);
        if (s.status === 'normal' && prev && prev.status !== 'normal') this.log('normal', s.id, `عودة المحطة ${s.id} للنطاق الطبيعي`, 'انخفض المنسوب المحلي دون حد التحذير.');
      });
      // Infer propagation from the first matching rise at adjacent stations in this
      // isolated experiment. Never infer direction from the source selector in flat mode.
      const pairs = [];
      for (let i = 0; i < STATIONS.length - 1; i++) {
        const a = this.firstArrivals[i], b = this.firstArrivals[i + 1];
        if (a === undefined || b === undefined || a === b) continue;
        pairs.push({ from: b > a ? i : i + 1, to: b > a ? i + 1 : i,
          direction: b > a ? 'forward' : 'reverse', velocity: this.distance(i, i + 1) / Math.abs(b - a),
          elapsed: Math.abs(b - a), time: Math.max(a, b) });
      }
      const observed = pairs.sort((a, b) => b.time - a.time)[0];
      if (observed && (!this.observation || this.observation.time !== observed.time)) {
        this.observation = observed;
        this.log('direction', STATIONS[observed.to].id, 'تقدير اتجاه الموجة وسرعتها', `${STATIONS[observed.from].id} → ${STATIONS[observed.to].id}: ${this.distance(observed.from, observed.to).toFixed(0)} م خلال ${observed.elapsed.toFixed(0)} ثانية؛ سرعة انتقال مقدّرة ${observed.velocity.toFixed(2)} م/ث.`);
      }
      const horizon = this.travelTime(0, 3, Math.min(this.velocity, this.forecastSpeed)) + 180;
      this.detections = this.detections.filter(d => this.time - d.time < horizon);
      states.forEach((s, i) => {
        const direction = this.observedDirection;
        const detection = this.detections.filter(d => d.index !== i && (direction === 'unknown' || (direction === 'forward' ? d.index < i : d.index > i)))
          .map(d => ({ ...d, arrival: d.time + this.travelTime(d.index, i, this.forecastSpeed), eta: d.time + this.travelTime(d.index, i, this.forecastSpeed) - this.time }))
          .filter(d => d.eta > 0).sort((a, b) => a.eta - b.eta)[0];
        if (detection && s.status === 'normal') {
          s.early = { source: STATIONS[detection.index].id, eta: detection.eta, arrival: detection.arrival, distance: this.distance(detection.index, i), velocity: this.forecastSpeed, conditional: direction === 'unknown' };
          if (!this.previous[s.id]?.early) this.log('early', s.id, `${s.early.conditional ? 'تنبيه احتمالي' : 'تنبيه مبكر'} للمحطة ${s.id}`, `ارتفاع في ${s.early.source}. ${s.early.conditional ? 'إذا اتجهت الموجة نحو هذه المحطة: ' : ''}وصول تقديري خلال ${Math.ceil(s.early.eta)} ثانية، بسرعة انتقال ${s.early.velocity.toFixed(2)} م/ث.`);
        }
        this.previous[s.id] = { status: s.status, early: !!s.early, rising: s.level - s.base > 12 && s.rate > 6 };
      });
      return states;
    }
    step(dt = 1) {
      if (!Number.isFinite(dt) || dt <= 0) return this.states;
      let remaining = dt;
      while (remaining > 0.0001) {
        const increment = Math.min(1, remaining);
        this.time += increment; remaining -= increment;
        this.states = this.evaluate();
        this.history.push({ time: this.time, levels: this.states.map(s => s.level), waveVelocity: this.forecastSpeed, waveBasis: this.observation ? 'estimated' : 'assumed', direction: this.observedDirection, directionBasis: this.observation ? 'observed_sequence' : this.terrain === 'flat' ? 'unknown' : 'configured' });
      }
      this.history = this.history.filter(h => h.time >= this.time - 240);
      this.waves = this.waves.filter(w => this.time < w.start + this.travelTime(0, 3) + w.width * 2 + 15);
      return this.states;
    }
  }
  return { Simulation, STATIONS, SCENARIOS, WARNING, DANGER };
});
