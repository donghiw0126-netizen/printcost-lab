'use strict';
// PrintCost Lab 화면 동작. 계산 규칙은 logic.js 에 있습니다.
(function () {
  const L = window.PrintCostLogic;
  const VERSION = '0.3.0';
  const KEY_SETTINGS = 'printcost:settings';
  const KEY_JOB = 'printcost:job';

  // 필라멘트 구매 링크 (쿠팡 파트너스 등). 필라멘트 id → 링크 주소.
  // 링크가 하나라도 있으면 필라멘트 옆에 "구매" 버튼과 아래쪽 고지 문구가 나타납니다.
  // 예: pla: 'https://link.coupang.com/a/xxxx'
  const SHOP_LINKS = {};

  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    e.append(...children);
    return e;
  };

  // ---------- 저장 (실패해도 앱은 동작) ----------
  function load(key) {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 무시 */ }
  }

  let settings = L.normalizeSettings(load(KEY_SETTINGS));
  const savedJob = load(KEY_JOB) || {};
  let lastResult = null;

  const COLORS = {
    filament: 'var(--c-filament)',
    electricity: 'var(--c-power)',
    depreciation: 'var(--c-dep)',
    upkeep: 'var(--c-upkeep)',
    fail: 'var(--c-fail)',
  };
  const LABELS = {
    filament: '필라멘트',
    electricity: '전기료',
    depreciation: '감가상각',
    upkeep: '유지비',
    fail: '실패 대비',
  };
  // 상품마다 다른 입력값(새로고침해도 유지). 후가공 시간·내가 정한 가격도 상품별이라 여기에 둡니다.
  const jobInputs = ['grams', 'pieces', 'hours', 'minutes', 'store', 's-post', 's-own'];
  const materialLabel = (id) => (L.MATERIALS.find((m) => m.id === id) || { label: id }).label;

  function activePrinter() {
    return settings.printers.find((p) => p.id === settings.activePrinterId) || settings.printers[0];
  }
  function currentFilament() {
    return settings.filaments.find((f) => f.id === settings.lastFilamentId) || settings.filaments[0];
  }

  // 설정을 바꾸고 → 정리 → 저장 → 화면 전체 다시 그리기
  function commit(next) {
    settings = L.normalizeSettings(next);
    save(KEY_SETTINGS, settings);
    renderAll();
  }
  function updateActivePrinter(changes) {
    const id = activePrinter().id;
    commit({
      ...settings,
      printers: settings.printers.map((p) => (p.id === id ? { ...p, ...changes } : p)),
    });
  }

  // ---------- 기종 목록(브랜드별 묶음) ----------
  function fillPresetSelect(select, selectedId) {
    select.textContent = '';
    const groups = new Map();
    for (const pr of L.PRINTER_PRESETS) {
      if (!groups.has(pr.brand)) groups.set(pr.brand, []);
      groups.get(pr.brand).push(pr);
    }
    for (const [brand, list] of groups) {
      const og = el('optgroup', { label: brand });
      for (const pr of list) {
        const tag = pr.source === 'custom' ? '' : ` · ${L.SOURCES[pr.source]}`;
        og.appendChild(el('option', { value: pr.id, textContent: `${pr.model}${tag}` }));
      }
      select.appendChild(og);
    }
    select.value = selectedId;
  }

  // ---------- 이번 출력: 프린터·필라멘트 선택 ----------
  function renderPickers() {
    const ps = $('printer');
    ps.textContent = '';
    for (const p of settings.printers) ps.appendChild(el('option', { value: p.id, textContent: p.name }));
    ps.value = activePrinter().id;

    const fs = $('filament');
    fs.textContent = '';
    for (const f of settings.filaments) fs.appendChild(el('option', { value: f.id, textContent: f.name }));
    fs.value = currentFilament().id;

    const p = activePrinter();
    const f = currentFilament();
    const pw = L.powerFor(p, f.type);
    const src = L.printerSource(p);
    const hint = $('pick-hint');
    hint.textContent = '';
    hint.append(
      `${pw.watts}W (${L.POWER_LABELS[pw.key]} 기준) `,
      el('span', { className: 'badge ' + src, textContent: L.SOURCES[src] }),
      ` · 1g당 ${L.formatWon(L.costPerGram(f))}`,
    );
    if (pw.fallback) {
      hint.append(el('span', {
        className: 'fallback',
        textContent: ` · ${materialLabel(f.type)} 전력 자료가 없어 ${L.POWER_LABELS[pw.key]} 값을 써요`,
      }));
    }
    if (SHOP_LINKS[f.id]) {
      hint.append(' ', el('a', {
        href: SHOP_LINKS[f.id], target: '_blank', rel: 'sponsored noopener', className: 'buy', textContent: '구매하기 ↗',
      }));
    }
  }

  // ---------- 계산 ----------
  function readJob() {
    const raw = (id) => $(id).value.trim();
    const grams = raw('grams') === '' ? 0 : L.parseNumber(raw('grams'));
    const hours = L.toHours(raw('hours'), raw('minutes'));
    const pieces = raw('pieces') === '' ? 1 : L.parseNumber(raw('pieces'));
    const store = raw('store') === '' ? 0 : L.parseNumber(raw('store'));
    const errors = [];
    if (Number.isNaN(grams)) errors.push('사용량');
    if (Number.isNaN(hours)) errors.push('출력 시간');
    if (Number.isNaN(pieces) || pieces < 1) errors.push('개수');
    if (Number.isNaN(store)) errors.push('사는 가격');
    return { grams, hours, pieces, store, errors };
  }

  function update() {
    const job = readJob();
    const err = $('job-error');
    err.hidden = job.errors.length === 0;
    err.textContent = job.errors.length ? `${job.errors.join(', ')}에 숫자만 넣어 주세요.` : '';

    const safe = {
      grams: Number.isNaN(job.grams) ? 0 : job.grams,
      hours: Number.isNaN(job.hours) ? 0 : job.hours,
      pieces: Number.isNaN(job.pieces) || job.pieces < 1 ? 1 : job.pieces,
    };
    const p = activePrinter();
    const f = currentFilament();
    const r = L.calcCost(safe, f, p, { failRate: settings.failRate, kwhRate: settings.kwhRate });

    $('total').textContent = L.formatWon(r.total);
    $('per-piece').textContent = r.pieces > 1 ? `1개당 ${L.formatWon(r.perPiece)} · ${r.pieces}개` : '';

    const items = [
      ['filament', r.parts.filament],
      ['electricity', r.parts.electricity],
      ['depreciation', r.parts.depreciation],
      ['upkeep', r.parts.upkeep],
      ['fail', r.failExtra],
    ];
    const bar = $('bar');
    const list = $('breakdown');
    bar.textContent = '';
    list.textContent = '';
    for (const [key, value] of items) {
      if (r.total > 0 && value > 0) {
        const seg = el('span');
        seg.style.width = (value / r.total) * 100 + '%';
        seg.style.background = COLORS[key];
        bar.appendChild(seg);
      }
      const dot = el('i');
      dot.style.background = COLORS[key];
      const li = el('li', null, dot, el('span', { textContent: LABELS[key] }));
      let valueNode;
      if (key === 'depreciation' && !p.includeDepreciation) {
        li.className = 'off';
        valueNode = el('b', { textContent: '제외' });
      } else if (key === 'depreciation' && r.needsPrice) {
        li.className = 'off';
        valueNode = el('button', { type: 'button', className: 'link-btn', textContent: '가격 입력 →' });
        valueNode.addEventListener('click', focusPrice);
      } else {
        valueNode = el('b', { textContent: L.formatWon(value) });
      }
      const pct = el('small', {
        textContent: li.className !== 'off' && r.total > 0 ? Math.round((value / r.total) * 100) + '%' : '',
      });
      li.append(pct, valueNode);
      list.appendChild(li);
    }
    $('kwh').textContent = safe.hours > 0
      ? `${r.power.watts}W × ${L.formatHours(safe.hours)} = 약 ${r.kwh.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}kWh`
      : '';

    // 사기 vs 뽑기
    const box = $('compare');
    const c = !Number.isNaN(job.store) && r.total > 0 ? L.compare(r.perPiece, job.store) : null;
    box.hidden = !c;
    if (c) {
      box.className = 'compare ' + (c.cheaper ? 'good' : 'bad');
      box.textContent = '';
      box.append(
        el('strong', {
          textContent: c.cheaper
            ? `직접 뽑으면 1개당 ${L.formatWon(c.saving)} 아껴요`
            : `사는 게 1개당 ${L.formatWon(-c.saving)} 더 싸요`,
        }),
        el('span', {
          textContent: c.cheaper
            ? `사는 값보다 ${Math.round(c.percent)}% 저렴`
            : '시간·수고까지 생각하면 구매가 나을 수 있어요',
        }),
      );
    }
    lastResult = { r, job: safe, f, p };
    updateSale(safe.grams > 0 || safe.hours > 0 ? r.perPiece : 0);
  }

  // ---------- 판매가 계산 ----------
  function renderSale() {
    const s = settings.sale;
    const sel = $('s-platform');
    if (!sel.options.length) {
      for (const pf of L.PLATFORMS) sel.appendChild(el('option', { value: pf.id, textContent: pf.label }));
    }
    sel.value = s.platformId;
    const platform = L.findPlatform(s.platformId);
    $('s-fee').value = String(s.fee);
    $('s-platform-note').textContent = platform.note
      + (s.fee !== platform.fee && platform.id !== 'custom' ? ` (기본값 ${platform.fee}%에서 고친 값)` : '');
    $('s-wage').value = s.hourlyWage.toLocaleString('ko-KR');
    $('s-pack').value = s.packaging.toLocaleString('ko-KR');
    $('s-ship').value = s.shipping.toLocaleString('ko-KR');
    $('s-free').checked = s.freeShipping;
    $('s-margin').value = s.margin;
    $('s-margin-out').textContent = s.margin + '%';
  }

  function updateSale(unitCost) {
    const s = settings.sale;
    const postRaw = $('s-post').value.trim();
    const post = postRaw === '' ? 0 : L.parseNumber(postRaw);
    const costs = L.saleCosts(unitCost, { ...s, postMinutes: Number.isNaN(post) ? 0 : post });
    const rec = L.recommendPrice(costs.total, s.fee, s.margin);

    const priceEl = $('s-price');
    const sub = $('s-price-sub');
    const summary = $('sale-summary');
    if (!(unitCost > 0)) {
      priceEl.textContent = '-';
      sub.textContent = '위 계산기에 사용량·출력 시간을 먼저 넣어 주세요.';
      summary.textContent = '';
    } else if (!rec.ok) {
      priceEl.textContent = '계산 불가';
      sub.textContent = '수수료 + 목표 이익률이 100% 이상이에요. 이익률을 낮춰 주세요.';
      summary.textContent = '';
    } else {
      priceEl.textContent = L.formatWon(rec.price);
      sub.textContent = `수수료 ${L.formatWon(rec.at.fee)} 빼고 1개당 ${L.formatWon(rec.at.profit)} 남아요 (이익률 ${Math.round(rec.at.margin)}%)`;
      summary.textContent = `권장 ${L.formatWon(rec.price)} · ${L.findPlatform(s.platformId).label}`;
    }

    const rows = [
      ['출력 원가', costs.parts.print],
      ['후가공 인건비', costs.parts.labor],
      ['포장비', costs.parts.packaging],
      ['배송비', s.freeShipping ? costs.parts.shipping : null],
    ];
    const list = $('s-costs');
    list.textContent = '';
    for (const [label, value] of rows) {
      const li = el('li', { className: 'plain' }, el('span', { textContent: label }),
        el('b', { textContent: value === null ? '구매자 부담' : L.formatWon(value) }));
      if (value === null) li.classList.add('off');
      list.appendChild(li);
    }
    list.appendChild(el('li', { className: 'plain sum' }, el('span', { textContent: '1개 팔 때 드는 비용' }),
      el('b', { textContent: L.formatWon(costs.total) })));

    $('s-breakeven').textContent = rec.ok && unitCost > 0
      ? `손익분기 가격 ${L.formatWon(rec.breakEven)} — 이보다 싸게 팔면 손해예요.`
      : '';

    // 내가 정한 가격
    const ownRaw = $('s-own').value.trim();
    const own = ownRaw === '' ? 0 : L.parseNumber(ownRaw);
    const box = $('s-own-result');
    box.hidden = !(own > 0 && unitCost > 0);
    if (!box.hidden) {
      const pr = L.profitAt(own, costs.total, s.fee);
      box.className = 'compare ' + (pr.profit > 0 ? 'good' : 'bad');
      box.textContent = '';
      box.append(
        el('strong', {
          textContent: pr.profit > 0
            ? `1개당 ${L.formatWon(pr.profit)} 남아요 (이익률 ${Math.round(pr.margin)}%)`
            : `1개당 ${L.formatWon(-pr.profit)} 손해예요`,
        }),
        el('span', { textContent: `수수료 ${L.formatWon(pr.fee)} · 비용 ${L.formatWon(costs.total)}` }),
      );
    }
  }

  function focusPrice() {
    $('printer-box').open = true;
    const input = $('p-price');
    input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------- 내 프린터 ----------
  function renderPrinterSettings() {
    const p = activePrinter();
    const preset = L.findPreset(p.presetId);

    // 저장한 프린터 탭 (2대 이상일 때만)
    const tabs = $('printer-tabs');
    tabs.textContent = '';
    tabs.hidden = settings.printers.length < 2;
    for (const pr of settings.printers) {
      const b = el('button', { type: 'button', className: 'tab', textContent: pr.name });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(pr.id === p.id));
      b.addEventListener('click', () => commit({ ...settings, activePrinterId: pr.id }));
      tabs.appendChild(b);
    }

    fillPresetSelect($('p-preset'), p.presetId);
    $('p-name').value = p.name;

    const src = L.printerSource(p);
    const badge = $('p-source');
    badge.className = 'badge ' + src;
    badge.textContent = L.SOURCES[src];
    $('p-note').textContent = p.edited && preset && preset.id !== 'custom'
      ? `직접 고친 값이에요. 기종 기본값: ${preset.note}`
      : preset ? preset.note : '';

    const grid = $('power-grid');
    grid.textContent = '';
    for (const key of L.POWER_KEYS) {
      const input = el('input', {
        inputMode: 'decimal',
        autocomplete: 'off',
        value: p.power[key] ? String(p.power[key]) : '',
        placeholder: key === 'pla' ? '' : '없음',
      });
      input.setAttribute('aria-label', `${L.POWER_LABELS[key]} 평균 소비전력(W)`);
      input.addEventListener('change', () => {
        const n = L.parseNumber(input.value.trim());
        const power = { ...activePrinter().power, [key]: Number.isNaN(n) || n <= 0 ? null : n };
        updateActivePrinter({ power, edited: true });
      });
      grid.appendChild(el('label', { className: 'power-cell' },
        el('span', { textContent: L.POWER_LABELS[key] }),
        el('div', { className: 'unit-input' }, input, el('em', { textContent: 'W' }))));
    }

    $('p-dep').checked = p.includeDepreciation;
    $('dep-fields').classList.toggle('disabled', !p.includeDepreciation);
    $('p-price').value = p.price > 0 ? p.price.toLocaleString('ko-KR') : '';
    $('p-price').classList.toggle('need', p.includeDepreciation && !(p.price > 0));
    $('p-life').value = p.lifeHours.toLocaleString('ko-KR');
    $('p-upkeep').value = p.upkeepPerHour.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    $('p-reset').disabled = !p.edited || p.presetId === 'custom';
    $('p-delete').disabled = settings.printers.length <= 1;

    $('printer-summary').textContent = settings.printers.length > 1
      ? `${settings.printers.length}대 · 지금: ${p.name}`
      : `${p.name} · PLA ${p.power.pla}W`;

    fillPresetSelect($('add-preset'), $('add-preset').value || L.DEFAULT_PRESET_ID);
    $('add-printer').disabled = settings.printers.length >= L.MAX_PRINTERS;
  }

  // ---------- 전기 요금 ----------
  function renderRate() {
    $('rate').value = settings.kwhRate.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    $('rate-summary').textContent = `${settings.kwhRate}원/kWh`;
    for (const chip of $('rate-chips').children) {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.rate) === settings.kwhRate));
    }
  }

  // ---------- 내 필라멘트 ----------
  function renderFilamentList() {
    const ul = $('fil-list');
    ul.textContent = '';
    for (const f of settings.filaments) {
      const name = el('input', { value: f.name, maxLength: 30 });
      name.setAttribute('aria-label', '필라멘트 이름');

      const type = el('select');
      type.setAttribute('aria-label', `${f.name} 종류`);
      for (const m of L.MATERIALS) type.appendChild(el('option', { value: m.id, textContent: m.label }));
      type.value = f.type;

      const price = el('input', { value: f.price.toLocaleString('ko-KR'), inputMode: 'numeric' });
      price.setAttribute('aria-label', `${f.name} 스풀 가격(원)`);
      const weight = el('input', { value: f.weight.toLocaleString('ko-KR'), inputMode: 'numeric' });
      weight.setAttribute('aria-label', `${f.name} 스풀 무게(g)`);

      const per = el('span', { className: 'per', textContent: L.formatWon(L.costPerGram(f)) });
      const del = el('button', { type: 'button', className: 'icon-btn', textContent: '✕' });
      del.setAttribute('aria-label', `${f.name} 삭제`);
      del.disabled = settings.filaments.length <= 1;

      const save = () => {
        commit({
          ...settings,
          filaments: settings.filaments.map((x) => (x.id === f.id ? {
            ...x,
            name: name.value.trim() ? name.value : f.name, // 이름을 지우면 원래 이름 유지
            type: type.value,
            price: price.value,
            weight: weight.value,
          } : x)),
        });
      };
      for (const input of [name, type, price, weight]) input.addEventListener('change', save);
      del.addEventListener('click', () => {
        if (settings.filaments.length <= 1) return;
        commit({ ...settings, filaments: settings.filaments.filter((x) => x.id !== f.id) });
      });

      ul.appendChild(el('li', { className: 'fil-row' }, name, type, price, weight, per, del));
    }
    $('fil-add').disabled = settings.filaments.length >= L.MAX_FILAMENTS;
    $('filament-summary').textContent = `${settings.filaments.length}종`;
  }

  function renderAll() {
    renderPickers();
    renderPrinterSettings();
    renderRate();
    renderFilamentList();
    renderSale();
    update();
  }

  // ---------- 이벤트 ----------
  function saveJob() {
    const job = {};
    for (const id of jobInputs) job[id] = $(id).value;
    save(KEY_JOB, job);
  }
  for (const id of jobInputs) {
    const input = $(id);
    input.value = typeof savedJob[id] === 'string' ? savedJob[id].slice(0, 20) : '';
    input.addEventListener('input', () => {
      update();
      saveJob();
    });
  }

  $('printer').addEventListener('change', (e) => commit({ ...settings, activePrinterId: e.target.value }));
  $('filament').addEventListener('change', (e) => commit({ ...settings, lastFilamentId: e.target.value }));

  const fail = $('fail');
  fail.value = settings.failRate;
  $('fail-out').textContent = settings.failRate + '%';
  fail.addEventListener('input', () => {
    settings.failRate = Number(fail.value);
    $('fail-out').textContent = fail.value + '%';
    save(KEY_SETTINGS, settings);
    update();
  });

  $('p-preset').addEventListener('change', (e) => {
    const id = activePrinter().id;
    commit({
      ...settings,
      printers: settings.printers.map((p) => (p.id === id ? L.changePreset(p, e.target.value) : p)),
    });
  });
  $('p-name').addEventListener('change', (e) => updateActivePrinter({ name: e.target.value }));
  $('p-dep').addEventListener('change', (e) => updateActivePrinter({ includeDepreciation: e.target.checked }));
  $('p-price').addEventListener('change', (e) => updateActivePrinter({ price: e.target.value.trim() || 0 }));
  $('p-life').addEventListener('change', (e) => updateActivePrinter({ lifeHours: e.target.value }));
  $('p-upkeep').addEventListener('change', (e) => updateActivePrinter({ upkeepPerHour: e.target.value }));
  $('p-reset').addEventListener('click', () => {
    const p = activePrinter();
    const fresh = L.changePreset(p, p.presetId);
    updateActivePrinter({ power: fresh.power, edited: false });
  });
  $('p-delete').addEventListener('click', () => {
    if (settings.printers.length <= 1) return;
    const id = activePrinter().id;
    const rest = settings.printers.filter((p) => p.id !== id);
    commit({ ...settings, printers: rest, activePrinterId: rest[0].id });
  });
  $('add-printer').addEventListener('click', () => {
    const p = L.newPrinter($('add-preset').value);
    commit({ ...settings, printers: [...settings.printers, p], activePrinterId: p.id });
    focusPrice();
  });

  // 판매가 설정
  const setSale = (changes) => commit({ ...settings, sale: { ...settings.sale, ...changes } });
  $('s-platform').addEventListener('change', (e) =>
    setSale({ platformId: e.target.value, fee: L.findPlatform(e.target.value).fee }));
  $('s-fee').addEventListener('change', (e) => setSale({ fee: e.target.value }));
  $('s-wage').addEventListener('change', (e) => setSale({ hourlyWage: e.target.value }));
  $('s-pack').addEventListener('change', (e) => setSale({ packaging: e.target.value }));
  $('s-ship').addEventListener('change', (e) => setSale({ shipping: e.target.value }));
  $('s-free').addEventListener('change', (e) => setSale({ freeShipping: e.target.checked }));
  $('s-margin').addEventListener('input', (e) => {
    // 끄는 동안 부드럽게: 화면 전체를 다시 그리지 않고 저장·계산만
    settings.sale.margin = Number(e.target.value);
    $('s-margin-out').textContent = e.target.value + '%';
    save(KEY_SETTINGS, settings);
    update();
  });

  function setRate(value) {
    commit({ ...settings, kwhRate: value });
  }
  $('rate').addEventListener('change', (e) => setRate(e.target.value));
  for (const preset of L.KWH_PRESETS) {
    const b = el('button', { type: 'button', className: 'chip', textContent: `${preset.label} ${preset.rate}원` });
    b.dataset.rate = preset.rate;
    b.addEventListener('click', () => setRate(preset.rate));
    $('rate-chips').appendChild(b);
  }

  $('fil-add').addEventListener('click', () => {
    const id = L.newId();
    commit({
      ...settings,
      filaments: [...settings.filaments, { id, name: '새 필라멘트', type: 'pla', price: 20000, weight: 1000 }],
      lastFilamentId: id,
    });
    const rows = $('fil-list').querySelectorAll('.fil-row > input:first-child');
    const last = rows[rows.length - 1];
    if (last) {
      last.focus();
      last.select();
    }
  });

  $('clear').addEventListener('click', () => {
    for (const id of jobInputs) $(id).value = '';
    saveJob();
    update();
    $('grams').focus();
  });

  $('copy').addEventListener('click', async () => {
    if (!lastResult) return;
    const { r, job, f, p } = lastResult;
    const text = L.summaryText(r, job, f, p) + '\n' + location.href.split('#')[0];
    const msg = $('copy-msg');
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = '복사했어요. 카톡·커뮤니티에 붙여 넣어 보세요.';
    } catch (e) {
      msg.textContent = '복사할 수 없는 환경이에요.';
    }
    setTimeout(() => { msg.textContent = ''; }, 3000);
  });

  // ---------- 시작 ----------
  $('version').textContent = VERSION;
  $('affiliate-note').hidden = Object.keys(SHOP_LINKS).length === 0;
  save(KEY_SETTINGS, settings); // v0.1 설정이면 새 형식으로 바로 저장
  renderAll();
})();
