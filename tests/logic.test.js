'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const PLA = { id: 'pla', name: 'PLA', type: 'pla', price: 20000, weight: 1000 };
const ABS = { id: 'abs', name: 'ABS', type: 'abs', price: 22000, weight: 1000 };
// 계산하기 쉬운 숫자의 프린터 (PLA 100W)
const P = {
  ...L.newPrinter('custom', 'test'),
  power: { pla: 100, petg: null, abs: 150, pc: null },
  price: 600000, lifeHours: 6000, upkeepPerHour: 30, includeDepreciation: true,
};
const OPTS = { failRate: 0, kwhRate: 200 };

test('parseNumber: 쉼표·원 허용, 이상한 값은 NaN', () => {
  assert.equal(L.parseNumber('1,234'), 1234);
  assert.equal(L.parseNumber('20,000원'), 20000);
  assert.equal(L.parseNumber('12.5'), 12.5);
  assert.equal(L.parseNumber('.5'), 0.5);
  assert.ok(Number.isNaN(L.parseNumber('-3')));
  assert.ok(Number.isNaN(L.parseNumber('abc')));
  assert.ok(Number.isNaN(L.parseNumber('')));
  assert.ok(Number.isNaN(L.parseNumber(Infinity)));
});

test('toHours: 시간·분 합치기, 빈 칸은 0', () => {
  assert.equal(L.toHours('2', '30'), 2.5);
  assert.equal(L.toHours('', '45'), 0.75);
  assert.equal(L.toHours('', ''), 0);
  assert.ok(Number.isNaN(L.toHours('x', '1')));
});

test('calcCost: 항목별 비용', () => {
  const r = L.calcCost({ grams: 50, hours: 2, pieces: 1 }, PLA, P, OPTS);
  assert.equal(r.parts.filament, 1000); // 50g × 20원
  assert.equal(r.parts.electricity, 40); // 2h × 0.1kW × 200원
  assert.equal(r.parts.depreciation, 200); // 2h × 600000 / 6000
  assert.equal(r.parts.upkeep, 60);
  assert.equal(r.total, 1300);
  assert.equal(r.failExtra, 0);
  assert.equal(r.kwh, 0.2);
  assert.equal(r.needsPrice, false);
});

test('calcCost: 재료에 맞는 전력 사용 (ABS 150W)', () => {
  const r = L.calcCost({ grams: 0, hours: 2 }, ABS, { ...P, upkeepPerHour: 0, includeDepreciation: false }, OPTS);
  assert.equal(r.power.watts, 150);
  assert.equal(r.power.key, 'abs');
  assert.equal(r.parts.electricity, 60);
});

test('calcCost: 실패율 10%면 ÷0.9, 50%까지만', () => {
  const r = L.calcCost({ grams: 50, hours: 2 }, PLA, P, { ...OPTS, failRate: 10 });
  assert.ok(Math.abs(r.total - 1300 / 0.9) < 1e-9);
  assert.equal(L.calcCost({ grams: 100, hours: 0 }, PLA, P, { failRate: 99 }).total, 4000);
});

test('calcCost: 감가상각 끄기 / 가격 미입력 표시', () => {
  const off = L.calcCost({ grams: 0, hours: 2 }, PLA, { ...P, includeDepreciation: false }, OPTS);
  assert.equal(off.parts.depreciation, 0);
  assert.equal(off.needsPrice, false);
  const noPrice = L.calcCost({ grams: 0, hours: 2 }, PLA, { ...P, price: 0 }, OPTS);
  assert.equal(noPrice.parts.depreciation, 0);
  assert.equal(noPrice.needsPrice, true);
});

test('calcCost: 한 판 여러 개면 1개당 비용', () => {
  const r = L.calcCost({ grams: 50, hours: 2, pieces: 4 }, PLA, P, OPTS);
  assert.equal(r.perPiece, 325);
  assert.equal(L.calcCost({ grams: 1, hours: 0, pieces: 0 }, PLA, P, OPTS).pieces, 1);
});

test('powerFor: 자료 없는 재료는 다음 값으로', () => {
  assert.deepEqual(L.powerFor(P, 'pla'), { watts: 100, key: 'pla', fallback: false });
  assert.deepEqual(L.powerFor(P, 'asa'), { watts: 150, key: 'abs', fallback: false });
  assert.deepEqual(L.powerFor(P, 'petg'), { watts: 100, key: 'pla', fallback: true });
  assert.deepEqual(L.powerFor(P, 'pc'), { watts: 150, key: 'abs', fallback: true });
  assert.deepEqual(L.powerFor(P, 'tpu'), { watts: 100, key: 'pla', fallback: false });
});

test('프리셋: P1S 공식값 105W, 모든 프리셋에 PLA 값과 근거', () => {
  const p1s = L.newPrinter('bambu-p1s');
  assert.equal(p1s.name, 'Bambu Lab P1S');
  assert.equal(p1s.power.pla, 105);
  assert.equal(p1s.power.abs, 140);
  assert.equal(p1s.price, 0); // 가격은 사용자가 입력
  assert.equal(L.printerSource(p1s), 'official');
  const ids = new Set();
  for (const pr of L.PRINTER_PRESETS) {
    assert.ok(pr.power.pla > 0, pr.id);
    assert.ok(L.SOURCES[pr.source], pr.id);
    assert.ok(!ids.has(pr.id), '중복 id ' + pr.id);
    ids.add(pr.id);
  }
});

test('changePreset: 전력·기본 이름은 바뀌고 가격은 유지', () => {
  const p = { ...L.newPrinter('bambu-p1s'), price: 900000, edited: true };
  const a1 = L.changePreset(p, 'bambu-a1');
  assert.equal(a1.name, 'Bambu Lab A1');
  assert.equal(a1.power.pla, 95);
  assert.equal(a1.price, 900000);
  assert.equal(a1.edited, false);
  // 이름을 직접 바꿨다면 유지
  const named = L.changePreset({ ...p, name: '거실 프린터' }, 'bambu-a1');
  assert.equal(named.name, '거실 프린터');
});

test('printerSource: 직접 고치면 직접 입력', () => {
  assert.equal(L.printerSource({ ...L.newPrinter('bambu-a1'), edited: true }), 'custom');
  assert.equal(L.printerSource(L.newPrinter('creality-k1c')), 'estimate');
  assert.equal(L.printerSource(L.newPrinter('custom')), 'custom');
});

test('guessMaterial', () => {
  assert.equal(L.guessMaterial('eSUN PETG 검정'), 'petg');
  assert.equal(L.guessMaterial('PLA-CF'), 'pla');
  assert.equal(L.guessMaterial('ASA'), 'asa');
  assert.equal(L.guessMaterial('PC Blend'), 'pc');
  assert.equal(L.guessMaterial('나무 필라멘트'), 'other');
});

test('compare: 사는 값과 비교', () => {
  assert.deepEqual(L.compare(300, 1000), { saving: 700, percent: 70, cheaper: true });
  assert.equal(L.compare(300, 200).cheaper, false);
  assert.equal(L.compare(300, 0), null);
});

test('formatWon / formatHours', () => {
  assert.equal(L.formatWon(1234.4), '1,234원');
  assert.equal(L.formatWon(3.25), '3.3원');
  assert.equal(L.formatWon(0), '0원');
  assert.equal(L.formatWon(-500), '-500원');
  assert.equal(L.formatHours(2.5), '2시간 30분');
  assert.equal(L.formatHours(0.25), '15분');
  assert.equal(L.formatHours(3), '3시간');
});

test('normalizeSettings: 빈 값이면 기본값(P1S)', () => {
  const s = L.normalizeSettings(null);
  assert.equal(s.version, 2);
  assert.equal(s.printers.length, 1);
  assert.equal(s.printers[0].presetId, 'bambu-p1s');
  assert.equal(s.activePrinterId, s.printers[0].id);
  assert.equal(s.kwhRate, 215);
  assert.equal(s.filaments.length, L.DEFAULT_FILAMENTS.length);
});

test('normalizeSettings: v0.1 설정 자동 변환 (기본 130W → 공식 105W)', () => {
  const s = L.normalizeSettings({
    version: 1,
    printer: { name: 'Bambu Lab P1S', watts: 130, kwhRate: 120, price: 900000, lifeHours: 6000, upkeepPerHour: 30, includeDepreciation: true },
    failRate: 7,
    filaments: [{ id: 'pla', name: 'PLA', price: 20000, weight: 1000 }, { id: 'x', name: '내 PETG', price: 19000, weight: 1000 }],
    lastFilamentId: 'x',
  });
  const p = s.printers[0];
  assert.equal(p.presetId, 'bambu-p1s');
  assert.equal(p.power.pla, 105);
  assert.equal(p.edited, false);
  assert.equal(p.price, 900000);
  assert.equal(s.kwhRate, 120);
  assert.equal(s.failRate, 7);
  assert.equal(s.filaments[1].type, 'petg'); // 이름으로 짐작
  assert.equal(s.lastFilamentId, 'x');
});

test('normalizeSettings: v0.1 에서 전력을 직접 고쳤다면 유지', () => {
  const s = L.normalizeSettings({ printer: { watts: 118 } });
  assert.equal(s.printers[0].power.pla, 118);
  assert.equal(s.printers[0].edited, true);
});

test('normalizeSettings: 이상한 값 정리', () => {
  const s = L.normalizeSettings({
    kwhRate: '300',
    failRate: 90,
    printers: [
      { id: 'a', presetId: 'bambu-a1', name: '', power: { pla: -5, abs: 'x' }, lifeHours: 0, includeDepreciation: false },
      { id: 'a', presetId: 'nope', name: '중복', power: { pla: 99999 } },
      'garbage',
    ],
    activePrinterId: 'zzz',
    filaments: [
      { id: 'f', name: '  내 PLA ', type: 'weird', price: '18000', weight: 1000 },
      { id: 'g', name: '', price: 1 },
    ],
  });
  assert.equal(s.kwhRate, 300);
  assert.equal(s.failRate, 50);
  assert.equal(s.printers.length, 2);
  const [a, b] = s.printers;
  assert.equal(a.name, 'Bambu Lab A1');
  assert.equal(a.power.pla, 95); // 음수 → 기종 기본값
  assert.equal(a.power.abs, null);
  assert.equal(a.lifeHours, 1); // 0 → 최소 1 (0으로 나누기 방지)
  assert.equal(a.includeDepreciation, false);
  assert.notEqual(b.id, 'a');
  assert.equal(b.presetId, 'custom');
  assert.equal(b.power.pla, 5000); // 상한
  assert.equal(s.activePrinterId, 'a');
  assert.equal(s.filaments.length, 1);
  assert.equal(s.filaments[0].name, '내 PLA');
  assert.equal(s.filaments[0].type, 'pla');
});

// ---------- v0.3 판매가 계산 ----------
test('saleCosts: 무료배송일 때만 배송비가 비용', () => {
  const sale = { postMinutes: 30, hourlyWage: 10000, packaging: 500, shipping: 3000, freeShipping: false };
  const a = L.saleCosts(1000, sale);
  assert.equal(a.parts.labor, 5000);
  assert.equal(a.parts.shipping, 0);
  assert.equal(a.total, 6500);
  assert.equal(L.saleCosts(1000, { ...sale, freeShipping: true }).total, 9500);
  assert.equal(L.saleCosts(-5, {}).total, 0);
});

test('recommendPrice: 비용 ÷ (1 − 수수료 − 이익률), 100원 올림 (부동소수 오차 없이)', () => {
  const r = L.recommendPrice(6000, 10, 30);
  assert.equal(r.ok, true);
  assert.equal(r.price, 10000); // 6000/0.6 = 10000.000…2 → 10,100 이 되면 안 됨
  assert.equal(r.breakEven, 6670); // 6000/0.9 = 6666.7 → 10원 올림
  assert.equal(r.at.fee, 1000);
  assert.equal(r.at.profit, 3000);
  assert.equal(r.at.margin, 30);
  assert.equal(L.recommendPrice(6001, 10, 30).price, 10100);
});

test('recommendPrice: 수수료 + 이익률 ≥ 100% 면 불가능', () => {
  assert.equal(L.recommendPrice(1000, 50, 60).ok, false);
  assert.equal(L.recommendPrice(1000, 22, 80).ok, true); // 이익률은 60%까지만 → 가능
  assert.equal(L.recommendPrice(1000, 39, 60).ok, true);
});

test('profitAt: 정한 가격의 이익', () => {
  const p = L.profitAt(8900, 6000, 6.6);
  assert.ok(Math.abs(p.fee - 587.4) < 1e-9);
  assert.ok(Math.abs(p.profit - 2312.6) < 1e-9);
  assert.equal(L.profitAt(5000, 6000, 0).profit, -1000);
  assert.equal(L.profitAt(0, 100, 10).margin, 0);
});

test('roundUp', () => {
  assert.equal(L.roundUp(101, 100), 200);
  assert.equal(L.roundUp(100, 100), 100);
  assert.equal(L.roundUp(0, 100), 0);
});

test('normalizeSale: 기본값과 이상한 값', () => {
  const d = L.normalizeSettings(null).sale;
  assert.equal(d.platformId, 'smartstore');
  assert.equal(d.fee, 6.6);
  assert.equal(d.hourlyWage, 10000);
  assert.equal(d.margin, 30);
  const s = L.normalizeSale({ platformId: 'idus', fee: 'x', margin: 200, freeShipping: 'yes', packaging: '1,200' });
  assert.equal(s.fee, 22); // 숫자가 아니면 판매처 기본값
  assert.equal(s.margin, 60);
  assert.equal(s.freeShipping, false);
  assert.equal(s.packaging, 1200);
  assert.equal(L.normalizeSale({ platformId: 'nope' }).platformId, 'smartstore');
});

test('PLATFORMS: id 중복 없고 수수료 0~99%', () => {
  const ids = new Set(L.PLATFORMS.map((p) => p.id));
  assert.equal(ids.size, L.PLATFORMS.length);
  for (const p of L.PLATFORMS) assert.ok(p.fee >= 0 && p.fee < 100 && p.note, p.id);
});
