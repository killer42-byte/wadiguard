(() => {
  'use strict';
  const { Simulation, STATIONS, SCENARIOS, WARNING, DANGER } = WadiEngine;
  const sim = new Simulation();
  const $ = id => document.getElementById(id);
  const statusText = { normal: 'طبيعي', warning: 'تحذير', danger: 'خطر' };
  const statusColor = { normal: '#26845b', warning: '#e58231', danger: '#c74739', early: '#e58231' };
  const stationColor = s => statusColor[s.status !== 'normal' ? s.status : s.early ? 'early' : 'normal'];
  const lineDashes = [[], [7, 4], [2, 4], [10, 3, 2, 3]];
  let playing = true, speed = 2, currentView = 'overview', selectedStation = null, sound = false, audioContext, toastTimer;
  let lastEventId = 0, eventFilter = 'all', accumulator = 0;
  const clock = time => {
    const total = Math.max(0, Math.floor(time)) + 18 * 3600;
    return [Math.floor(total / 3600) % 24, Math.floor(total / 60) % 60, total % 60].map(n => String(n).padStart(2, '0')).join(':');
  };
  const duration = seconds => {
    const value = Math.max(0, Math.ceil(seconds));
    return value >= 60 ? `${Math.floor(value / 60)} د ${value % 60} ث` : `${value} ث`;
  };
  const routeText = direction => direction === 'unknown' ? 'A ↔ B ↔ C ↔ D' : direction === 'reverse' ? 'D → C → B → A' : 'A → B → C → D';
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
  function badge(s) { return `<span class="status-tag ${s.status}"><i class="legend-dot ${s.status}"></i>${statusText[s.status]}</span>`; }
  function eventHTML(e, compact = false) {
    const symbol = { system: '✓', simulation: '≈', rise: '↗', warning: '!', danger: '!', early: '↳', normal: '✓', direction: '⇄' }[e.type];
    return `<article class="event-row ${e.type}"><span class="event-symbol">${symbol}</span><div class="event-copy"><h3>${e.title}</h3>${compact ? '' : `<p>${e.message}</p>`}</div><time dir="ltr">${clock(e.time)}</time></article>`;
  }
  function buildMap() {
    const contours = [];
    // Deterministic elevation contours: a schematic terrain, not geographic survey data.
    for (const [cx, cy, rx, ry, phase] of [[69,65,270,172,1],[665,124,248,203,2],[-20,490,283,225,3],[700,610,170,169,4]]) {
      for (let j = 0; j < 13; j++) {
        const points = [];
        for (let i = 0; i <= 90; i++) {
          const a = i / 90 * Math.PI * 2;
          const scale = 0.2 + j * .075;
          const wobble = 1 + .06 * Math.sin(a * 5 + phase) + .035 * Math.cos(a * 9 + j * .12);
          points.push(`${i ? 'L' : 'M'}${(cx + Math.cos(a) * rx * scale * wobble).toFixed(1)},${(cy + Math.sin(a) * ry * scale * wobble).toFixed(1)}`);
        }
        contours.push(`<path d="${points.join(' ')}Z"/>`);
      }
    }
    $('contours').innerHTML = contours.join('');
    $('map-stations').innerHTML = STATIONS.map(s => {
      const right = s.id === 'A' || s.id === 'C';
      const x = right ? s.x + 29 : s.x - 176;
      return `<g class="map-station" data-station="${s.id}" tabindex="0" role="button" aria-label="عرض المحطة ${s.id}"><circle class="station-ring" id="ring-${s.id}" cx="${s.x}" cy="${s.y}" r="24" fill="#26845b15" stroke="#26845b" stroke-width="1"/><circle id="node-${s.id}" cx="${s.x}" cy="${s.y}" r="13" fill="#26845b" stroke="#26845b" stroke-width="2"/><circle cx="${s.x}" cy="${s.y}" r="4" fill="#fffdf2"/><rect id="map-label-box-${s.id}" x="${x}" y="${s.y - 25}" width="146" height="57" rx="7" fill="#fffdf2f5" stroke="#26845b" stroke-width=".8"/><circle id="label-dot-${s.id}" cx="${x + 13}" cy="${s.y - 8}" r="3" fill="#26845b"/><text class="map-label" x="${x + 24}" y="${s.y - 4}">STATION ${s.id}</text><text class="map-sub-label" x="${x + 132}" y="${s.y + 17}" text-anchor="start" id="map-reading-${s.id}">${s.name}</text></g>`;
    }).join('');
    $('chart-legend').innerHTML = STATIONS.map((s, i) => `<span><svg viewBox="0 0 28 8" aria-hidden="true"><path id="legend-line-${s.id}" d="M0 4H28" stroke="#26845b" stroke-width="2" stroke-dasharray="${lineDashes[i].join(' ')}"/></svg>Station ${s.id}</span>`).join('');
  }
  function renderDirection() {
    const direction = sim.direction;
    $('table-direction').textContent = routeText(direction);
    $('lab-route').textContent = routeText(direction);
    document.body.classList.toggle('direction-reverse', direction === 'reverse');
    $('map-flow-key').textContent = direction === 'reverse' ? '↑ اتجاه السيل: D إلى A' : '↓ اتجاه السيل: A إلى D';
    const river = $('river-path'), length = river.getTotalLength();
    $('flow-arrows').innerHTML = [.24, .36, .49, .63, .76, .9].map(fraction => {
      const p = river.getPointAtLength(length * fraction), q = river.getPointAtLength(length * fraction + 2);
      const angle = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI + (direction === 'reverse' ? 180 : 0);
      return '<g transform="translate(' + p.x + ',' + p.y + ') rotate(' + angle + ')"><path d="M-6-6 0 0-6 6"/></g>';
    }).join('');
    $('launch-button').disabled = sim.active;
    $('launch-button').title = sim.active ? 'الموجة قيد الانتقال؛ أعد الضبط لبدء تجربة أخرى' : 'إطلاق موجة جديدة';
  }
  function render() {
    const states = sim.states;
    $('header-clock').textContent = clock(sim.time);
    const max = states.reduce((a, b) => a.level > b.level ? a : b);
    const alerts = states.filter(s => s.status !== 'normal' || s.early);
    const early = states.filter(s => s.early);
    $('max-level').textContent = Math.round(max.level);
    $('max-station').textContent = `المحطة ${max.id} · ${max.name}`;
    $('active-alerts').textContent = String(alerts.length).padStart(2, '0');
    $('active-alerts').style.color = states.some(s => s.status === 'danger') ? statusColor.danger : alerts.length ? statusColor.warning : '';
    $('alerts-foot').textContent = alerts.length ? `${states.filter(s => s.status !== 'normal').length} محلية · ${early.length} استباقية` : 'المناسيب ضمن النطاق الطبيعي';
    const target = [...early].sort((a, b) => a.early.eta - b.early.eta)[0];
    $('lead-time').textContent = target ? Math.ceil(target.early.eta) : '—';
    $('lead-foot').textContent = target ? `${target.early.conditional ? 'وصول مشروط' : 'وصول تقديري'} إلى ${target.id} عند ${clock(target.early.arrival)}` : 'بانتظار رصد موجة بين المحطات';
    $('nav-alert-count').textContent = sim.events.filter(e => ['warning', 'danger', 'early'].includes(e.type)).length;
    const trace = sim.history.slice(-40).map((h, i, a) => `${i ? 'L' : 'M'}${i / Math.max(1, a.length - 1) * 100},${26 - Math.min(200, h.levels[STATIONS.findIndex(s => s.id === max.id)]) / 200 * 24}`).join(' ');
    $('metric-spark-path').setAttribute('d', trace);
    states.forEach(s => {
      const color = stationColor(s);
      $(`ring-${s.id}`).setAttribute('stroke', color);
      $(`ring-${s.id}`).setAttribute('fill', color + '15');
      $(`node-${s.id}`).setAttribute('stroke', color);
      $(`node-${s.id}`).setAttribute('fill', color);
      $(`legend-line-${s.id}`).setAttribute('stroke', color);
      $(`map-label-box-${s.id}`).setAttribute('stroke', color);
      $(`label-dot-${s.id}`).setAttribute('fill', color);
      $(`map-reading-${s.id}`).textContent = `${Math.round(s.level)} سم · ${s.early ? s.early.conditional ? 'تنبيه احتمالي' : 'تنبيه مبكر' : statusText[s.status]}`;
    });
    if (currentView === 'events') renderEvents();
    if (currentView === 'stations') $('stations-table').innerHTML = states.map(s => `<tr><td><span class="station-letter">${s.id}</span>${s.name}</td><td>${s.km.toFixed(1)} كم</td><td>${s.level.toFixed(1)} سم</td><td dir="ltr">${s.rate > 0 ? '+' : ''}${s.rate.toFixed(1)} cm/min</td><td>${badge(s)}</td><td>${s.early ? `<span class="status-tag early">من ${s.early.source} · ${duration(s.early.eta)}</span><small>${s.early.conditional ? 'مشروط بالاتجاه' : 'وصول تقديري'} ${clock(s.early.arrival)} · ${s.early.velocity.toFixed(2)} م/ث</small>` : '—'}</td></tr>`).join('');
    if (selectedStation && $('station-dialog').open) renderDialog();
    if (sound && sim.events.some(e => e.id > lastEventId && ['danger', 'early'].includes(e.type))) beep();
    lastEventId = sim.sequence;
    renderDirection();
    drawChart();
  }
  function renderEvents() {
    const events = sim.events.filter(e => eventFilter === 'all' || e.type === eventFilter);
    $('full-events').innerHTML = events.length ? events.map(e => eventHTML(e)).join('') : '<p class="empty-message">لا توجد أحداث من هذا النوع حتى الآن.</p>';
  }
  function drawChart() {
    if (currentView !== 'overview') return;
    $('wadi-map').setAttribute('viewBox', window.innerWidth <= 760 ? '145 0 520 555' : '0 0 740 555');
    const canvas = $('level-chart'), rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!rect.width) return;
    const width = rect.width, height = rect.height;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const l = 33, r = 12, top = 14, bottom = height - 23, plotWidth = width - l - r;
    const maximum = Math.max(180, Math.ceil(Math.max(...sim.history.flatMap(h => h.levels)) / 60) * 60);
    const y = n => bottom - n / maximum * (bottom - top);
    ctx.font = '9px Segoe UI'; ctx.textAlign = 'right'; ctx.fillStyle = '#69818a';
    for (let i = 0; i <= 3; i++) { const value = maximum / 3 * i; ctx.beginPath(); ctx.strokeStyle = '#d8ddcf'; ctx.lineWidth = .7; ctx.moveTo(l, y(value)); ctx.lineTo(width - r, y(value)); ctx.stroke(); ctx.fillText(Math.round(value), l - 8, y(value) + 3); }
    for (const [value, color, label] of [[WARNING, '#b56527', 'تحذير'], [DANGER, '#b44336', 'خطر']]) {
      ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.strokeStyle = color + '66'; ctx.moveTo(l, y(value)); ctx.lineTo(width - r, y(value)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.font = '8px Tahoma'; ctx.fillText(label, width - r - 3, y(value) - 4);
    }
    const end = Math.max(90, sim.time), start = end - 240;
    const x = time => l + (time - start) / 240 * plotWidth;
    ctx.save();ctx.beginPath();ctx.rect(l, top, plotWidth, bottom - top);ctx.clip();
    STATIONS.forEach((s, index) => {
      const data = sim.history.filter(h => h.time >= start);
      if (!data.length) return;
      ctx.beginPath(); data.forEach((h, i) => i ? ctx.lineTo(x(h.time), y(h.levels[index])) : ctx.moveTo(x(h.time), y(h.levels[index])));
      ctx.strokeStyle = stationColor(sim.states[index]); ctx.setLineDash(lineDashes[index]); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      const last = data[data.length - 1]; ctx.beginPath(); ctx.arc(x(last.time), y(last.levels[index]), 2.6, 0, Math.PI * 2); ctx.fillStyle = stationColor(sim.states[index]);ctx.fill();
    });ctx.restore();
    ctx.font = '8px Segoe UI';ctx.fillStyle = '#627b83';ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) { const t = start + i * 60; const label = t < 0 ? `−${Math.abs(Math.round(t))}s` : clock(t).slice(3);ctx.fillText(label, x(t), height - 5); }
  }
  function renderDialog() {
    const s = sim.states.find(s => s.id === selectedStation);
    $('dialog-title').textContent = `المحطة ${s.id} · ${s.name}`;
    $('dialog-content').innerHTML = `${badge(s)}<div class="dialog-reading">${s.level.toFixed(1)} <small>سم</small></div><div class="dialog-details"><div><span>سرعة تغيّر المنسوب</span><strong dir="ltr">${s.rate > 0 ? '+' : ''}${s.rate.toFixed(1)} cm/min</strong></div><div><span>الموقع على المجرى من A</span><strong>${s.km.toFixed(1)} كم</strong></div><div><span>سرعة المياه المفترضة</span><strong>${sim.velocity.toFixed(1)} م/ث</strong></div><div><span>سرعة انتقال الموجة ${sim.observation ? 'المقدّرة' : 'المفترضة'}</span><strong>${sim.forecastSpeed.toFixed(2)} م/ث</strong></div><div><span>اتجاه انتشار الموجة</span><strong dir="ltr">${routeText(sim.observedDirection)}</strong></div><div><span>التحذير / الخطر</span><strong>65 / 110 سم</strong></div></div><div class="dialog-forecast">${s.early ? `${s.early.conditional ? 'تنبيه مشروط: إذا اتجهت الموجة نحو هذه المحطة،' : 'تنبيه مبكر:'} ارتفاع مرصود في ${s.early.source}. وصول تقديري عند ${clock(s.early.arrival)}، خلال ${duration(s.early.eta)}. المسافة ${s.early.distance.toFixed(0)} م؛ السرعة المستخدمة ${s.early.velocity.toFixed(2)} م/ث.` : 'لا يوجد توقع وصول نشط لهذه المحطة.'}</div><p class="dialog-note">آخر تحديث ${clock(sim.time)} · جميع المدد بتوقيت المحاكاة · ليست قراءة حساس سرعة فعلي</p>`;
  }
  function navigate(view) {
    currentView = view;
    const titles = { overview: ['نظرة عامة', 'كل نقطة تروي ما هو قادم.', 'رصد لحظي لحركة المياه، ورؤية مبكرة لما يحدث على امتداد الوادي.'], stations: ['محطات الرصد', 'أربع محطات. صورة مترابطة.', 'القراءات المحلية والتنبيهات الاستباقية لجميع نقاط الرصد.'], events: ['سجل التنبيهات', 'كل تغيّر، في وقته.', 'تتبّع بداية الارتفاع وانتقال الموجة وتسلسل الإنذار.'], about: ['عن النموذج', 'من رصد المياه إلى استباقها.', 'كيف تعمل التجربة، وما الذي يمكن تطويره لاحقًا.'] };
    document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${view}`);
    document.querySelectorAll('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    $('breadcrumb-view').textContent = titles[view][0]; $('page-title').textContent = titles[view][1]; $('page-subtitle').textContent = titles[view][2];render();
  }
  function setPlaying(value) {
    playing = value; document.body.classList.toggle('paused', !playing);
    $('play-button').innerHTML = playing ? '<span class="pause-icon">Ⅱ</span>' : '<svg><use href="#i-play"/></svg>';
    $('play-button').setAttribute('aria-label', playing ? 'إيقاف المحاكاة مؤقتًا' : 'استئناف المحاكاة');
    $('play-button').title = playing ? 'إيقاف مؤقت' : 'استئناف';
    $('live-badge').innerHTML = `<i class="status-dot" style="background:${playing ? '#26845b' : '#e58231'}"></i>${playing ? 'مباشر' : 'متوقف مؤقتًا'}`;
  }
  function beep() {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(.04, audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .2);oscillator.start();oscillator.stop(audioContext.currentTime + .2);
  }
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-view], [data-go]'); if (nav) navigate(nav.dataset.view || nav.dataset.go);
    const station = e.target.closest('[data-station]');if (station) { selectedStation = station.dataset.station;renderDialog();$('station-dialog').showModal(); }
  });
  $('map-stations').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-station]')) { e.preventDefault();e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  $('close-dialog').onclick = () => $('station-dialog').close();
  $('station-dialog').addEventListener('click', e => { if (e.target === $('station-dialog')) { const rect = e.target.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) e.target.close(); } });
  $('event-filter').onchange = e => { eventFilter = e.target.value;renderEvents(); };
  $('play-button').onclick = () => setPlaying(!playing);
  $('speed').onchange = e => { speed = Number(e.target.value); toast(`سرعة المحاكاة ${speed}×`); };
  $('launch-button').onclick = () => { if (!sim.launch($('scenario').value)) return;setPlaying(true);render();toast(`تم إطلاق ${SCENARIOS[$('scenario').value].label} من ${STATIONS[sim.sourceIndex].id} بسرعة مفترضة ${sim.velocity} م/ث`); };
  $('reset-button').onclick = () => { sim.reset();accumulator = 0;lastEventId = sim.sequence;setPlaying(true);render();toast('أُعيدت المحطات إلى الحالة الطبيعية وبدأ سجل جديد'); };
  for (const id of ['water-speed', 'flow-source']) $(id).onchange = () => {
    sim.configure({ velocity: Number($('water-speed').value), terrain: 'slope', direction: $('flow-source').value });
    accumulator = 0;lastEventId = sim.sequence;render();
    toast('بدأت تجربة جديدة بالإعدادات المحدّثة. اضغط إطلاق الموجة.');
  };
  $('sound-button').onclick = async () => {
    try {
      if (!sound) { const Audio = window.AudioContext || window.webkitAudioContext; audioContext ||= new Audio();await audioContext.resume(); }
      sound = !sound;$('sound-button').innerHTML = `<svg><use href="#i-bell"/></svg>${sound ? '' : '<span class="muted-mark"></span>'}`;
      $('sound-button').setAttribute('aria-label', sound ? 'كتم صوت التنبيهات' : 'تفعيل صوت التنبيهات');$('sound-button').title = sound ? 'كتم صوت التنبيهات' : 'تفعيل صوت التنبيهات';
      toast(sound ? 'صوت تنبيهات الخطر والإنذار المبكر مفعّل' : 'تم كتم صوت التنبيهات'); if (sound) beep();
    } catch { toast('الصوت غير متاح في هذا المتصفح'); }
  };
  $('export-button').onclick = () => {
    const rows = ['simulation_seconds,simulation_clock,station,water_level_cm,assumed_water_velocity_m_s,wave_velocity_m_s,wave_velocity_basis,propagation_direction,direction_basis,data_source'];
    sim.history.filter(h => h.time >= 0).forEach(h => h.levels.forEach((level, i) => rows.push(`${h.time.toFixed(1)},${clock(h.time)},${STATIONS[i].id},${level.toFixed(2)},${sim.velocity},${(h.waveVelocity ?? sim.velocity).toFixed(3)},${h.waveBasis || 'assumed'},${h.direction || sim.observedDirection},${h.directionBasis || (sim.terrain === 'flat' ? 'unknown' : 'configured')},simulation`)));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');link.href = url;link.download = `wadiguard-readings-${Math.floor(sim.time)}s.csv`;document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);toast('تم تصدير القراءات المتاحة لآخر 4 دقائق بصيغة CSV');
  };
  buildMap();render();
  new ResizeObserver(drawChart).observe($('level-chart').parentElement);
  // The simulated clock pauses while the tab is hidden to keep the demonstration observable.
  let lastFrame = performance.now();
  function tick(now) {
    const dt = Math.min((now - lastFrame) / 1000, .25);lastFrame = now;
    if (playing && !document.hidden) { accumulator += dt * speed; if (accumulator >= 1) { const steps = Math.floor(accumulator);sim.step(steps);accumulator -= steps;render(); } }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
