'use strict';
// PrintCost Lab 계산 규칙 (화면과 무관한 순수 로직)
// 브라우저에서는 window.PrintCostLogic 으로, Node.js 테스트에서는 require('./logic.js') 로 사용합니다.
//
// 저장 설정 모양 (localStorage 'printcost:settings', version 2):
//   kwhRate:   전기 단가(원/kWh) — 모든 프린터 공통
//   failRate:  실패율(%) 0~50
//   printers:  [{ id, presetId, name,
//                 power: { pla, petg, abs, pc }  — 재료별 평균 소비전력(W), pla 외에는 null 가능
//                 edited: 전력값을 직접 고쳤는지,
//                 price: 프린터 가격(원, 0 = 미입력), lifeHours: 예상 수명(시간),
//                 upkeepPerHour: 시간당 유지비(원), includeDepreciation }]
//   activePrinterId
//   filaments: [{ id, name, type: MATERIALS 중 하나, price: 스풀 가격(원), weight: 스풀 무게(g) }]
//   lastFilamentId
//   sale: { platformId, fee: 수수료(%), hourlyWage: 시급, packaging: 1개 포장비, shipping: 배송비,
//           freeShipping: 무료배송(배송비를 판매가에 포함), margin: 목표 이익률(판매가 대비 %) }
//
// version 1(v0.1.0)은 printer 하나와 printer.kwhRate 를 가졌습니다 → normalizeSettings 가 자동 변환.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrintCostLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SETTINGS_VERSION = 2;
  const MAX_FAIL_RATE = 50;
  const MAX_FILAMENTS = 30;
  const MAX_PRINTERS = 10;
  const MAX_WATTS = 5000;

  // 전력 자료의 근거
  const SOURCES = {
    official: '공식',
    measured: '실측',
    estimate: '추정',
    custom: '직접 입력',
  };

  // 프린터 기종 프리셋 — PLA(등) 출력 중 "평균" 소비전력(W). 최대 전력(정격)이 아닙니다.
  //  - Bambu Lab: Bambu Lab 위키 'Power consumption' 표 (2026-11 확인). 짧은 시험 출력 기준.
  //  - Prusa: Prusa 공식 FAQ(MK 계열, 실온 26℃) / CORE One 사양.
  //  - Elegoo Centauri Carbon: Igor'sLAB 리뷰 실측(PLA 210/60℃).
  //  - 추정: 평균 자료가 없어 같은 구조(밀폐형 CoreXY / 개방형) 기종의 공식값을 기준으로 잡은 값.
  const PRINTER_PRESETS = [
    { id: 'bambu-a1-mini', brand: 'Bambu Lab', model: 'A1 mini', power: { pla: 80, petg: 75 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-a1', brand: 'Bambu Lab', model: 'A1', power: { pla: 95, abs: 200, pc: 150 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-a2l', brand: 'Bambu Lab', model: 'A2L', power: { pla: 145 }, source: 'official', note: 'Bambu Lab 위키 (PLA 1시간 측정)' },
    { id: 'bambu-p1p', brand: 'Bambu Lab', model: 'P1P', power: { pla: 110, abs: 170, pc: 160 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-p1s', brand: 'Bambu Lab', model: 'P1S', power: { pla: 105, abs: 140, pc: 135 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-p2s', brand: 'Bambu Lab', model: 'P2S', power: { pla: 200 }, source: 'official', note: 'Bambu Lab 위키 (PLA 정상 출력 전력)' },
    { id: 'bambu-x1c', brand: 'Bambu Lab', model: 'X1 / X1C', power: { pla: 105, abs: 150, pc: 135 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-x1e', brand: 'Bambu Lab', model: 'X1E', power: { pla: 185, abs: 260, pc: 230 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-x2d', brand: 'Bambu Lab', model: 'X2D', power: { pla: 250, pc: 550 }, source: 'official', note: 'Bambu Lab 위키 (실온 25℃ 정상 출력 전력)' },
    { id: 'bambu-h2s', brand: 'Bambu Lab', model: 'H2S', power: { pla: 200, petg: 180, pc: 330 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-h2d', brand: 'Bambu Lab', model: 'H2D', power: { pla: 197, petg: 150, pc: 395 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-h2c', brand: 'Bambu Lab', model: 'H2C', power: { pla: 200, petg: 193, pc: 294 }, source: 'official', note: 'Bambu Lab 위키 실측 표' },
    { id: 'bambu-h3c', brand: 'Bambu Lab', model: 'H3C', power: { pla: 240, pc: 540 }, source: 'official', note: 'Bambu Lab 위키 (실온 25℃ 정상 출력 전력)' },
    { id: 'prusa-mk4s', brand: 'Prusa', model: 'MK4S', power: { pla: 80, abs: 120 }, source: 'official', note: 'Prusa 공식 FAQ (실온 26℃)' },
    { id: 'prusa-core-one', brand: 'Prusa', model: 'CORE One', power: { pla: 90, abs: 110 }, source: 'official', note: 'Prusa 사양' },
    { id: 'elegoo-cc', brand: 'Elegoo', model: 'Centauri Carbon', power: { pla: 160 }, source: 'measured', note: "Igor'sLAB 리뷰 실측 (PLA 210/60℃)" },
    { id: 'creality-k1c', brand: 'Creality', model: 'K1C', power: { pla: 130 }, source: 'estimate', note: '평균 자료 없음 · 밀폐형 CoreXY 기종 기준 추정 (정격 350W)' },
    { id: 'creality-k2-plus', brand: 'Creality', model: 'K2 Plus', power: { pla: 200 }, source: 'estimate', note: '평균 자료 없음 · 대형 밀폐형 기종(H2 계열) 기준 추정' },
    { id: 'creality-ender3-v3', brand: 'Creality', model: 'Ender-3 V3', power: { pla: 100 }, source: 'estimate', note: '평균 자료 없음 · 개방형 기종 기준 추정 (정격 350W)' },
    { id: 'anycubic-kobra3', brand: 'Anycubic', model: 'Kobra 3', power: { pla: 100 }, source: 'estimate', note: '평균 자료 없음 · 개방형 기종 기준 추정' },
    { id: 'flashforge-ad5m', brand: 'Flashforge', model: 'Adventurer 5M', power: { pla: 100 }, source: 'estimate', note: '평균 자료 없음 · 개방형 기종 기준 추정 (정격 350W)' },
    { id: 'custom', brand: '기타', model: '직접 입력', power: { pla: 120 }, source: 'custom', note: '전력 측정 콘센트로 잰 값을 넣어 주세요' },
  ];
  const DEFAULT_PRESET_ID = 'bambu-p1s';

  // 필라멘트 종류 → 어떤 전력값을 쓸지
  const MATERIALS = [
    { id: 'pla', label: 'PLA' },
    { id: 'petg', label: 'PETG' },
    { id: 'abs', label: 'ABS' },
    { id: 'asa', label: 'ASA' },
    { id: 'tpu', label: 'TPU' },
    { id: 'pc', label: 'PC' },
    { id: 'other', label: '기타' },
  ];
  // 각 재료가 차례로 찾아볼 전력값. 자료가 없으면 다음 것, 마지막은 항상 pla.
  const POWER_LOOKUP = {
    pla: ['pla'],
    tpu: ['pla'],
    other: ['pla'],
    petg: ['petg', 'pla'],
    abs: ['abs', 'pla'],
    asa: ['abs', 'pla'], // ASA 는 ABS 와 온도가 비슷
    pc: ['pc', 'abs', 'pla'],
  };
  const POWER_KEYS = ['pla', 'petg', 'abs', 'pc'];
  const POWER_LABELS = { pla: 'PLA', petg: 'PETG', abs: 'ABS', pc: 'PC' };

  const DEFAULT_PRINTER_EXTRA = { price: 0, lifeHours: 6000, upkeepPerHour: 30, includeDepreciation: true };

  // 한국 판매가 대략치(1kg 스풀). 사용자가 산 가격으로 바꾸는 것을 전제로 합니다.
  const DEFAULT_FILAMENTS = [
    { id: 'pla', name: 'PLA', type: 'pla', price: 20000, weight: 1000 },
    { id: 'petg', name: 'PETG', type: 'petg', price: 20000, weight: 1000 },
    { id: 'tpu', name: 'TPU', type: 'tpu', price: 30000, weight: 1000 },
    { id: 'abs', name: 'ABS', type: 'abs', price: 22000, weight: 1000 },
    { id: 'asa', name: 'ASA', type: 'asa', price: 28000, weight: 1000 },
    { id: 'pla-cf', name: 'PLA-CF', type: 'pla', price: 35000, weight: 1000 },
  ];

  // 전기 단가 빠른 선택 (주택용 저압, 부가세·기금 제외 근사치)
  const KWH_PRESETS = [
    { label: '1구간', rate: 120 },
    { label: '2구간', rate: 215 },
    { label: '3구간', rate: 307 },
  ];
  const DEFAULT_KWH_RATE = 215;

  // 판매처 수수료(%, 부가세 포함 근사치). 2026-11 조사 — 자주 바뀌므로 판매자센터에서 최종 확인 전제.
  //  - 스마트스토어: 주문관리 3.63%(일반 등급, 신규 판매자 기본) + 네이버쇼핑 유입 판매수수료 2.73%(+VAT)
  //  - 쿠팡: 생활용품 판매수수료 7.8% + VAT
  //  - 아이디어스: 멤버십 없을 때 22%로 보수적으로 잡음(멤버십 가입 시 15% 안팎)
  const PLATFORMS = [
    { id: 'smartstore', label: '스마트스토어', fee: 6.6, note: '신규(일반 등급)·네이버쇼핑 유입 기준. 영세 등급 약 5%, 직접 만든 마케팅 링크로 들어온 주문은 약 3%.' },
    { id: 'coupang', label: '쿠팡 (생활용품)', fee: 8.6, note: '생활용품 7.8% + 부가세. 완구·취미 등 카테고리에 따라 더 높을 수 있어요.' },
    { id: 'idus', label: '아이디어스', fee: 22, note: '멤버십 없을 때 기준(보수적). 멤버십에 가입하면 15% 안팎으로 낮아진다고 알려져 있어요.' },
    { id: 'daangn', label: '당근', fee: 0, note: '수수료는 없지만 중고거래 서비스라, 새 물건을 반복해서 파는 건 정책상 제한될 수 있어요.' },
    { id: 'custom', label: '직접 입력', fee: 0, note: '크몽·오프라인 판매 등 수수료를 직접 넣으세요.' },
  ];
  const MAX_MARGIN = 60; // 화면 슬라이더 최대값과 같게

  // "1,234.5" → 1234.5, 숫자가 아니거나 음수면 NaN
  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const s = value.replace(/[,\s원]/g, '');
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // 시간·분 → 시간(소수). 빈 칸은 0으로 봅니다.
  function toHours(hours, minutes) {
    const h = hours === '' || hours == null ? 0 : parseNumber(hours);
    const m = minutes === '' || minutes == null ? 0 : parseNumber(minutes);
    if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
    return h + m / 60;
  }

  function costPerGram(filament) {
    if (!filament || !(filament.weight > 0)) return 0;
    return filament.price / filament.weight;
  }

  function findPreset(id) {
    return PRINTER_PRESETS.find((p) => p.id === id) || null;
  }

  function presetLabel(preset) {
    return preset.id === 'custom' ? preset.model : `${preset.brand} ${preset.model}`;
  }

  // 이 프린터로 이 재료를 뽑을 때 쓸 전력. { watts, key: 실제로 쓴 값의 재료, fallback: 다른 재료 값을 빌렸는지 }
  function powerFor(printer, materialType) {
    const order = POWER_LOOKUP[materialType] || POWER_LOOKUP.pla;
    const power = (printer && printer.power) || {};
    for (const key of order) {
      if (power[key] > 0) return { watts: power[key], key, fallback: key !== order[0] };
    }
    return { watts: 0, key: 'pla', fallback: true };
  }

  // 전력값의 근거 (직접 고쳤으면 '직접 입력')
  function printerSource(printer) {
    if (!printer) return 'custom';
    const preset = findPreset(printer.presetId);
    if (printer.edited || !preset) return 'custom';
    return preset.source;
  }

  // 한 번 출력(한 판)의 비용을 계산합니다.
  //   job: { grams, hours, pieces }  — pieces: 한 판에 나오는 개수(1 이상)
  //   opts: { failRate, kwhRate }
  // 실패율 r 이면 성공 한 번에 평균 1/(1-r) 번 출력해야 하므로 전체에 그 배율을 곱합니다.
  function calcCost(job, filament, printer, opts) {
    const o = opts || {};
    const grams = Math.max(0, job.grams || 0);
    const hours = Math.max(0, job.hours || 0);
    const pieces = Math.max(1, Math.floor(job.pieces || 1));
    const p = printer || newPrinter(DEFAULT_PRESET_ID);
    const power = powerFor(p, filament ? filament.type : 'pla');
    const kwhRate = o.kwhRate >= 0 ? o.kwhRate : DEFAULT_KWH_RATE;

    const parts = {
      filament: grams * costPerGram(filament),
      electricity: hours * (power.watts / 1000) * kwhRate,
      depreciation: p.includeDepreciation && p.lifeHours > 0 ? (hours * p.price) / p.lifeHours : 0,
      upkeep: hours * p.upkeepPerHour,
    };
    const base = parts.filament + parts.electricity + parts.depreciation + parts.upkeep;
    const r = clamp(o.failRate || 0, 0, MAX_FAIL_RATE) / 100;
    const total = base / (1 - r);
    return {
      parts,
      base,
      failExtra: total - base,
      total,
      perPiece: total / pieces,
      pieces,
      power,
      kwh: hours * (power.watts / 1000),
      needsPrice: p.includeDepreciation && !(p.price > 0),
    };
  }

  // 사는 값과 비교: storePrice 는 1개 가격
  function compare(perPiece, storePrice) {
    if (!(storePrice > 0)) return null;
    const saving = storePrice - perPiece;
    return { saving, percent: (saving / storePrice) * 100, cheaper: saving > 0 };
  }

  // ---------- 판매가 계산 ----------
  function findPlatform(id) {
    return PLATFORMS.find((p) => p.id === id) || PLATFORMS[PLATFORMS.length - 1];
  }

  function roundUp(n, step) {
    const s = step || 100;
    return Math.ceil(n / s - 1e-9) * s || 0; // 1e-9: 10000.0000000002 같은 부동소수 오차 무시, || 0: -0 방지
  }

  // 1개를 팔 때 드는 비용
  //   sale: { postMinutes: 1개당 후가공 시간(분), hourlyWage, packaging, shipping, freeShipping }
  function saleCosts(unitCost, sale) {
    const s = sale || {};
    const parts = {
      print: Math.max(0, unitCost || 0),
      labor: (Math.max(0, s.postMinutes || 0) / 60) * Math.max(0, s.hourlyWage || 0),
      packaging: Math.max(0, s.packaging || 0),
      shipping: s.freeShipping ? Math.max(0, s.shipping || 0) : 0, // 구매자가 따로 내면 비용 아님
    };
    return { parts, total: parts.print + parts.labor + parts.packaging + parts.shipping };
  }

  // 이 가격에 팔면: 수수료·이익·판매가 대비 이익률(%)
  function profitAt(price, costTotal, feePct) {
    const fee = price * (clamp(feePct || 0, 0, 100) / 100);
    const profit = price - fee - costTotal;
    return { price, fee, profit, margin: price > 0 ? (profit / price) * 100 : 0 };
  }

  // 목표 이익률(판매가 대비)을 남기는 판매가: 비용 ÷ (1 − 수수료 − 이익률), 100원 단위 올림
  // 수수료 + 이익률이 100% 이상이면 어떤 가격으로도 불가능 → ok: false
  function recommendPrice(costTotal, feePct, marginPct) {
    const rate = 1 - clamp(feePct || 0, 0, 100) / 100 - clamp(marginPct || 0, 0, MAX_MARGIN) / 100;
    if (rate <= 0) return { ok: false };
    const raw = costTotal / rate;
    const price = roundUp(raw, 100);
    const breakEven = feePct >= 100 ? Infinity : roundUp(costTotal / (1 - feePct / 100), 10);
    return { ok: true, raw, price, breakEven, at: profitAt(price, costTotal, feePct) };
  }

  function defaultSale() {
    return {
      platformId: 'smartstore',
      fee: findPlatform('smartstore').fee,
      hourlyWage: 10000,
      packaging: 500,
      shipping: 3000,
      freeShipping: false,
      margin: 30,
    };
  }

  function normalizeSale(raw) {
    const d = defaultSale();
    if (!raw || typeof raw !== 'object') return d;
    const platform = PLATFORMS.some((p) => p.id === raw.platformId) ? raw.platformId : d.platformId;
    return {
      platformId: platform,
      fee: numOr(raw.fee, findPlatform(platform).fee, 0, 99),
      hourlyWage: numOr(raw.hourlyWage, d.hourlyWage, 0, 1e6),
      packaging: numOr(raw.packaging, d.packaging, 0, 1e6),
      shipping: numOr(raw.shipping, d.shipping, 0, 1e6),
      freeShipping: raw.freeShipping === true,
      margin: numOr(raw.margin, d.margin, 0, MAX_MARGIN),
    };
  }

  function formatWon(n) {
    if (!Number.isFinite(n)) return '-';
    const abs = Math.abs(n);
    // 10원 미만은 소수 한 자리까지 보여 줍니다(작은 출력물의 전기료 등).
    const text = abs > 0 && abs < 10
      ? abs.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
      : Math.round(abs).toLocaleString('ko-KR');
    return (n < 0 ? '-' : '') + text + '원';
  }

  function formatHours(hours) {
    if (!Number.isFinite(hours)) return '-';
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return m + '분';
    return m === 0 ? h + '시간' : h + '시간 ' + m + '분';
  }

  // 공유용 요약
  function summaryText(result, job, filament, printer) {
    const lines = [
      '🖨️ PrintCost Lab 계산 결과',
      `${printer ? printer.name + ' · ' : ''}${filament ? filament.name : '필라멘트'} ${job.grams}g · ${formatHours(job.hours)}`,
      `총 ${formatWon(result.total)}` + (result.pieces > 1 ? ` (1개당 ${formatWon(result.perPiece)})` : ''),
    ];
    return lines.join('\n');
  }

  function newId(prefix) {
    return (prefix || 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function cleanName(s, max) {
    return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '';
  }

  function numOr(value, fallback, min, max) {
    const n = parseNumber(value);
    return Number.isNaN(n) ? fallback : clamp(n, min, max);
  }

  // 이름으로 재료 종류 짐작 (예전 설정·직접 추가한 필라멘트용)
  function guessMaterial(name) {
    const n = String(name || '').toUpperCase();
    if (n.includes('PETG')) return 'petg';
    if (n.includes('ASA')) return 'asa';
    if (n.includes('ABS')) return 'abs';
    if (n.includes('TPU')) return 'tpu';
    if (/\bPC\b|^PC/.test(n)) return 'pc';
    if (n.includes('PLA')) return 'pla';
    return 'other';
  }

  function presetPower(preset) {
    const out = {};
    for (const k of POWER_KEYS) out[k] = preset.power[k] > 0 ? preset.power[k] : null;
    return out;
  }

  // 프리셋으로 새 프린터 만들기 (가격은 비워 둠 = 사용자가 구매가 입력)
  function newPrinter(presetId, id) {
    const preset = findPreset(presetId) || findPreset('custom');
    return {
      id: id || newId('p'),
      presetId: preset.id,
      name: presetLabel(preset),
      power: presetPower(preset),
      edited: false,
      ...DEFAULT_PRINTER_EXTRA,
    };
  }

  // 기종을 바꾸면 전력값과 (기본 이름이었다면) 이름을 그 기종으로. 가격·수명 등은 유지.
  function changePreset(printer, presetId) {
    const preset = findPreset(presetId) || findPreset('custom');
    const oldPreset = findPreset(printer.presetId);
    const keepName = oldPreset && printer.name !== presetLabel(oldPreset);
    return {
      ...printer,
      presetId: preset.id,
      name: keepName ? printer.name : presetLabel(preset),
      power: presetPower(preset),
      edited: false,
    };
  }

  function defaultSettings() {
    const printer = newPrinter(DEFAULT_PRESET_ID, 'p1');
    return {
      version: SETTINGS_VERSION,
      kwhRate: DEFAULT_KWH_RATE,
      failRate: 5,
      printers: [printer],
      activePrinterId: printer.id,
      filaments: DEFAULT_FILAMENTS.map((f) => ({ ...f })),
      lastFilamentId: 'pla',
      sale: defaultSale(),
    };
  }

  function normalizePrinter(rp, seen) {
    if (!rp || typeof rp !== 'object') return null;
    const preset = findPreset(rp.presetId) || findPreset('custom');
    const base = newPrinter(preset.id);
    const id = typeof rp.id === 'string' && rp.id && !seen.has(rp.id) ? rp.id.slice(0, 40) : base.id;
    const power = {};
    const rawPower = rp.power && typeof rp.power === 'object' ? rp.power : {};
    for (const k of POWER_KEYS) {
      const n = parseNumber(rawPower[k]);
      power[k] = Number.isNaN(n) || n <= 0 ? null : clamp(n, 1, MAX_WATTS);
    }
    if (!power.pla) power.pla = base.power.pla;
    return {
      id,
      presetId: preset.id,
      name: cleanName(rp.name, 40) || base.name,
      power,
      edited: rp.edited === true || preset.id === 'custom',
      price: numOr(rp.price, 0, 0, 1e8),
      lifeHours: numOr(rp.lifeHours, DEFAULT_PRINTER_EXTRA.lifeHours, 1, 1e6),
      upkeepPerHour: numOr(rp.upkeepPerHour, DEFAULT_PRINTER_EXTRA.upkeepPerHour, 0, 1e5),
      includeDepreciation: rp.includeDepreciation !== false,
    };
  }

  // v0.1.0 설정(printer 하나) → v2 프린터
  function migrateV1Printer(old) {
    const p = newPrinter(DEFAULT_PRESET_ID, 'p1');
    if (cleanName(old.name, 40)) p.name = cleanName(old.name, 40);
    const watts = parseNumber(old.watts);
    // 130W 는 v0.1 의 추정 기본값 → 공식값(105W)으로 바꿔 줌. 다른 값이면 사용자가 고친 것으로 유지.
    if (!Number.isNaN(watts) && watts > 0 && watts !== 130) {
      p.power = { pla: clamp(watts, 1, MAX_WATTS), petg: null, abs: null, pc: null };
      p.edited = true;
    }
    p.price = numOr(old.price, 0, 0, 1e8);
    p.lifeHours = numOr(old.lifeHours, p.lifeHours, 1, 1e6);
    p.upkeepPerHour = numOr(old.upkeepPerHour, p.upkeepPerHour, 0, 1e5);
    p.includeDepreciation = old.includeDepreciation !== false;
    return p;
  }

  // 저장된 값(또는 이상한 값)을 안전한 설정으로 바꿉니다.
  function normalizeSettings(raw) {
    const d = defaultSettings();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;

    let printers = [];
    let kwhRaw = raw.kwhRate;
    if (Array.isArray(raw.printers)) {
      const seen = new Set();
      for (const rp of raw.printers) {
        const p = normalizePrinter(rp, seen);
        if (!p) continue;
        seen.add(p.id);
        printers.push(p);
        if (printers.length >= MAX_PRINTERS) break;
      }
    } else if (raw.printer && typeof raw.printer === 'object') {
      printers = [migrateV1Printer(raw.printer)];
      if (kwhRaw == null) kwhRaw = raw.printer.kwhRate;
    }
    if (printers.length === 0) printers = d.printers;
    const activePrinterId = printers.some((p) => p.id === raw.activePrinterId)
      ? raw.activePrinterId
      : printers[0].id;

    let filaments = [];
    const seenF = new Set();
    if (Array.isArray(raw.filaments)) {
      for (const f of raw.filaments) {
        if (!f || typeof f !== 'object') continue;
        const id = typeof f.id === 'string' && f.id && !seenF.has(f.id) ? f.id.slice(0, 40) : newId();
        const name = cleanName(f.name, 30);
        if (!name) continue;
        seenF.add(id);
        filaments.push({
          id,
          name,
          type: MATERIALS.some((m) => m.id === f.type) ? f.type : guessMaterial(name),
          price: numOr(f.price, 0, 0, 1e7),
          weight: numOr(f.weight, 1000, 1, 1e5),
        });
        if (filaments.length >= MAX_FILAMENTS) break;
      }
    }
    if (filaments.length === 0) filaments = d.filaments;
    const lastFilamentId = filaments.some((f) => f.id === raw.lastFilamentId)
      ? raw.lastFilamentId
      : filaments[0].id;

    return {
      version: SETTINGS_VERSION,
      kwhRate: numOr(kwhRaw, d.kwhRate, 0, 2000),
      failRate: numOr(raw.failRate, d.failRate, 0, MAX_FAIL_RATE),
      printers,
      activePrinterId,
      filaments,
      lastFilamentId,
      sale: normalizeSale(raw.sale),
    };
  }

  return {
    PLATFORMS, MAX_MARGIN, findPlatform, roundUp, saleCosts, profitAt, recommendPrice, defaultSale, normalizeSale,
    SETTINGS_VERSION, MAX_FAIL_RATE, MAX_FILAMENTS, MAX_PRINTERS,
    SOURCES, PRINTER_PRESETS, DEFAULT_PRESET_ID, MATERIALS, POWER_KEYS, POWER_LABELS,
    DEFAULT_FILAMENTS, KWH_PRESETS, DEFAULT_KWH_RATE,
    parseNumber, toHours, costPerGram, calcCost, compare, powerFor, printerSource,
    findPreset, presetLabel, newPrinter, changePreset, guessMaterial,
    formatWon, formatHours, summaryText,
    newId, defaultSettings, normalizeSettings,
  };
});
