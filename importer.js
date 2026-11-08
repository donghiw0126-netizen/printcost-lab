'use strict';
// PrintCost Lab 슬라이스 파일 읽기 (화면과 무관한 순수 로직)
// 브라우저에서는 window.PrintCostImporter, Node.js 테스트에서는 require('./importer.js').
// 파일은 브라우저 안에서만 읽고 어디에도 전송하지 않습니다.
//
// 지원:
//   .gcode.3mf / .3mf  — Bambu Studio·OrcaSlicer 의 "슬라이스된 플레이트" 파일 (ZIP).
//                         Metadata/slice_info.config 의 플레이트별 prediction(초)·weight(g)·filament 를 읽고,
//                         없으면 Metadata/plate_N.gcode 를 풀어 G-code 요약을 읽습니다.
//   .gcode             — Bambu Studio, OrcaSlicer, PrusaSlicer, SuperSlicer, Creality Print, Cura.
//                         슬라이서가 파일 앞(헤더)·뒤(요약)에 적어 둔 주석만 읽습니다.
//
// 결과: { slicer, plates: [{ index, seconds, grams, types: ['PLA', …], estimated, objects }] }
//   estimated: 무게를 길이로 환산한 경우(Cura) true
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrintCostImporter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // 사용자에게 그대로 보여 줄 수 있는 오류
  class ImportError extends Error {
    // kind: 화면에서 어떤 도움말을 보여 줄지 ('bgcode' | 'model' | 'project' | 'unknown' | '')
    constructor(message, kind) {
      super(message);
      this.name = 'ImportError';
      this.kind = kind || '';
    }
  }

  const HEAD_BYTES = 512 * 1024; // G-code 앞부분 (Bambu 는 썸네일·설정이 앞에 있어 넉넉히)
  const TAIL_BYTES = 512 * 1024; // G-code 뒷부분 (Prusa·Orca 요약과 설정)

  // "1d 2h 3m 4s", "2h 30m", "45m 10s", "30s" → 초
  function parseDuration(text) {
    if (typeof text !== 'string') return NaN;
    const re = /(\d+(?:\.\d+)?)\s*([dhms])/gi;
    const mult = { d: 86400, h: 3600, m: 60, s: 1 };
    let total = 0;
    let found = false;
    let m;
    while ((m = re.exec(text))) {
      total += Number(m[1]) * mult[m[2].toLowerCase()];
      found = true;
    }
    return found ? Math.round(total) : NaN;
  }

  function detectSlicer(text) {
    const checks = [
      [/BambuStudio/i, 'Bambu Studio'],
      [/OrcaSlicer/i, 'OrcaSlicer'],
      [/Creality\s*Print/i, 'Creality Print'],
      [/SuperSlicer/i, 'SuperSlicer'],
      [/PrusaSlicer/i, 'PrusaSlicer'],
      [/Cura_SteamEngine|;FLAVOR:/i, 'Cura'],
    ];
    for (const [re, name] of checks) if (re.test(text)) return name;
    return '';
  }

  // "1.23, 4.56" 처럼 여러 필라멘트 값 → 합
  function sumList(text) {
    let total = 0;
    let found = false;
    for (const part of String(text).split(/[,;]/)) {
      const n = Number(part.trim());
      if (part.trim() !== '' && Number.isFinite(n)) {
        total += n;
        found = true;
      }
    }
    return found ? total : NaN;
  }

  function firstMatch(text, patterns) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  function splitTypes(text) {
    if (!text) return [];
    return text.split(/[;,]/).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }

  // 재료별 대략 밀도(g/cm³) — Cura 처럼 길이만 있을 때 무게 환산용
  const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PC: 1.2 };

  function densityOf(type) {
    const t = String(type || '').toUpperCase();
    for (const key of Object.keys(DENSITY)) if (t.includes(key)) return DENSITY[key];
    return DENSITY.PLA;
  }

  // G-code 앞·뒤 텍스트에서 요약 읽기
  function parseGcode(head, tail) {
    const text = String(head || '') + '\n' + String(tail || '');
    if (!text.trim()) throw new ImportError('빈 파일이에요.');

    const slicer = detectSlicer(text);

    // 시간: 총 예상 시간(예열 포함) 우선
    let seconds = NaN;
    const timeText = firstMatch(text, [
      /;\s*total estimated time\s*[:=]\s*([^;\n]+)/i,
      /;\s*estimated printing time \(normal mode\)\s*=\s*([^\n]+)/i,
      /;\s*estimated printing time\s*=\s*([^\n]+)/i,
      /;\s*model printing time\s*[:=]\s*([^;\n]+)/i,
    ]);
    if (timeText) seconds = parseDuration(timeText);
    if (Number.isNaN(seconds)) {
      const cura = text.match(/;\s*TIME\s*:\s*(\d+(?:\.\d+)?)/i);
      if (cura) seconds = Math.round(Number(cura[1]));
    }

    const typeText = firstMatch(text, [/;\s*filament_type\s*=\s*([^\n]+)/i]);
    const types = splitTypes(typeText);

    // 무게
    let grams = NaN;
    let estimated = false;
    const gramText = firstMatch(text, [
      /;\s*total filament weight \[g\]\s*[:=]\s*([^\n]+)/i,
      /;\s*total filament used \[g\]\s*[:=]\s*([^\n]+)/i,
      /;\s*filament used \[g\]\s*[:=]\s*([^\n]+)/i,
    ]);
    if (gramText) grams = sumList(gramText);
    if (Number.isNaN(grams)) {
      // Cura: ";Filament used: 2.34567m" (여러 개면 "1.2m, 0.5m")
      const len = text.match(/;\s*Filament used\s*:\s*([^\n]+)/i);
      if (len) {
        const meters = sumList(len[1].replace(/m/gi, ''));
        if (Number.isFinite(meters)) {
          const r = 1.75 / 2; // mm
          const cm3 = (meters * 1000 * Math.PI * r * r) / 1000;
          grams = cm3 * densityOf(types[0]);
          estimated = true;
        }
      }
    }

    if (Number.isNaN(grams) && Number.isNaN(seconds)) {
      throw new ImportError('이 G-code에서 출력 시간·필라멘트 사용량 정보를 찾지 못했어요. 슬라이서가 요약을 적지 않는 설정일 수 있어요.');
    }
    return {
      slicer,
      plates: [{
        index: 1,
        seconds: Number.isNaN(seconds) ? 0 : seconds,
        grams: Number.isNaN(grams) ? 0 : grams,
        types,
        estimated,
        objects: 0,
      }],
    };
  }

  // Bambu Studio·OrcaSlicer 의 Metadata/slice_info.config (XML) 읽기
  function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i'));
    return m ? m[1] : null;
  }

  function parseSliceInfo(xml) {
    const text = String(xml || '');
    const plates = [];
    const plateRe = /<plate\b[^>]*>([\s\S]*?)<\/plate>/gi;
    let pm;
    while ((pm = plateRe.exec(text))) {
      const body = pm[1];
      const meta = {};
      for (const tag of body.match(/<metadata\b[^>]*\/?>/gi) || []) {
        const key = attr(tag, 'key');
        if (key) meta[key] = attr(tag, 'value');
      }
      const filaments = (body.match(/<filament\b[^>]*\/?>/gi) || []).map((tag) => ({
        type: attr(tag, 'type') || '',
        grams: Number(attr(tag, 'used_g')) || 0,
      }));
      const objects = (body.match(/<object\b[^>]*\/?>/gi) || [])
        .filter((tag) => attr(tag, 'skipped') !== 'true').length;
      const seconds = Number(meta.prediction);
      let grams = Number(meta.weight);
      if (!(grams > 0)) grams = filaments.reduce((s, f) => s + f.grams, 0);
      if (!(seconds > 0) && !(grams > 0)) continue; // 슬라이스 안 된 플레이트
      plates.push({
        index: Number(meta.index) || plates.length + 1,
        seconds: seconds > 0 ? Math.round(seconds) : 0,
        grams: grams > 0 ? grams : 0,
        types: filaments.map((f) => f.type).filter(Boolean),
        estimated: false,
        objects,
      });
    }
    const client = text.match(/X-BBL-Client-Type"\s+value="([^"]*)"/i);
    const version = text.match(/X-BBL-Client-Version"\s+value="([^"]*)"/i);
    return { plates, client: client ? client[1] : '', version: version ? version[1] : '' };
  }

  // ---------- 아주 작은 ZIP 읽기 (3MF 는 ZIP) ----------
  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }
  function u64(v, o) { return u32(v, o) + u32(v, o + 4) * 0x100000000; }

  // 중앙 디렉터리 → [{ name, method, compSize, size, offset }]
  function listZip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = bytes.byteLength;
    if (len < 22 || u32(v, 0) !== 0x04034b50) {
      throw new ImportError('3MF(압축) 파일 형식이 아니에요.');
    }
    // 끝에서부터 EOCD(0x06054b50) 찾기 (주석 최대 64KB)
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
      if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ImportError('3MF 파일이 손상됐거나 끝까지 받지 못한 것 같아요.');

    let count = u16(v, eocd + 10);
    let cdOffset = u32(v, eocd + 16);
    // ZIP64
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && u32(v, loc) === 0x07064b50) {
        const z = u64(v, loc + 8);
        if (u32(v, z) === 0x06064b50) {
          count = u64(v, z + 32);
          cdOffset = u64(v, z + 48);
        }
      }
    }

    const decoder = new TextDecoder();
    const entries = [];
    let p = cdOffset;
    for (let n = 0; n < count && p + 46 <= len; n++) {
      if (u32(v, p) !== 0x02014b50) break;
      const method = u16(v, p + 10);
      let compSize = u32(v, p + 20);
      let size = u32(v, p + 24);
      const nameLen = u16(v, p + 28);
      const extraLen = u16(v, p + 30);
      const commentLen = u16(v, p + 32);
      let offset = u32(v, p + 42);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 추가 필드: 0xFFFFFFFF 인 값만 순서대로(size, compSize, offset) 들어 있음
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = u16(v, e);
        const sz = u16(v, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(v, q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(v, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(v, q); }
        }
        e += 4 + sz;
      }
      entries.push({ name, method, compSize, size, offset });
      p = extraEnd + commentLen;
    }
    return entries;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new ImportError('이 브라우저는 3MF 압축 풀기를 지원하지 않아요. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZipEntry(buffer, entry) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const o = entry.offset;
    if (u32(v, o) !== 0x04034b50) throw new ImportError('3MF 파일 안의 내용을 읽지 못했어요.');
    const start = o + 30 + u16(v, o + 26) + u16(v, o + 28);
    const data = bytes.subarray(start, start + entry.compSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new ImportError('지원하지 않는 압축 방식이에요.');
  }

  async function readText(buffer, entry) {
    return new TextDecoder().decode(await readZipEntry(buffer, entry));
  }

  // .gcode.3mf / .3mf 읽기
  async function parse3mf(buffer) {
    const entries = listZip(buffer);
    const find = (re) => entries.find((e) => re.test(e.name));

    const info = find(/(^|\/)Metadata\/slice_info\.config$/i);
    if (info) {
      const parsed = parseSliceInfo(await readText(buffer, info));
      if (parsed.plates.length) {
        // 슬라이서 이름은 G-code 앞부분에서 (있으면)
        let slicer = parsed.client === 'slicer' ? 'Bambu Studio' : '';
        const gc = find(/(^|\/)Metadata\/plate_\d+\.gcode$/i);
        if (gc && gc.size < 200 * 1024 * 1024) {
          try {
            const text = await readText(buffer, gc);
            slicer = detectSlicer(text.slice(0, 4096)) || slicer;
          } catch (e) { /* 이름만 못 읽은 것 — 무시 */ }
        }
        return { slicer, plates: parsed.plates.sort((a, b) => a.index - b.index) };
      }
    }

    // slice_info 가 없거나 비어 있으면 G-code 직접
    const gcodes = entries.filter((e) => /(^|\/)Metadata\/plate_\d+\.gcode$/i.test(e.name));
    if (gcodes.length) {
      const plates = [];
      let slicer = '';
      for (const g of gcodes) {
        const text = await readText(buffer, g);
        const r = parseGcode(text.slice(0, HEAD_BYTES), text.slice(-TAIL_BYTES));
        slicer = slicer || r.slicer;
        const idx = Number((g.name.match(/plate_(\d+)/i) || [])[1]) || plates.length + 1;
        plates.push({ ...r.plates[0], index: idx });
      }
      return { slicer, plates: plates.sort((a, b) => a.index - b.index) };
    }

    if (entries.some((e) => /3D\/3dmodel\.model$/i.test(e.name))) {
      throw new ImportError('슬라이스하지 않은 3MF 프로젝트 파일이에요. Bambu Studio에서 슬라이스한 뒤 "플레이트 슬라이스 파일 내보내기"(.gcode.3mf)로 저장해 주세요.', 'project');
    }
    throw new ImportError('이 3MF 파일에서 슬라이스 정보를 찾지 못했어요.');
  }

  // 파일 종류 판단 (이름 + 앞부분 바이트)
  function fileKind(name, firstBytes) {
    const n = String(name || '').toLowerCase();
    const b = firstBytes || new Uint8Array(0);
    if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x43 && b[2] === 0x44 && b[3] === 0x45) return 'bgcode'; // "GCDE"
    if (n.endsWith('.bgcode')) return 'bgcode';
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return '3mf'; // "PK"
    if (n.endsWith('.3mf')) return '3mf';
    if (/\.(gcode|gco|g)$/.test(n)) return 'gcode';
    if (/\.(stl|obj|step|stp)$/.test(n)) return 'model';
    return 'unknown';
  }

  const KIND_ERRORS = {
    bgcode: 'Prusa의 바이너리 G-code(.bgcode)는 아직 읽지 못해요. PrusaSlicer 의 프린터 설정 → 일반 → 펌웨어에서 "바이너리 G-code 지원"을 끄고 다시 내보내 주세요.',
    model: 'STL·OBJ·STEP 같은 모델 파일에는 출력 시간이 없어요. 슬라이서에서 슬라이스한 뒤 .gcode 또는 .gcode.3mf 로 내보내 주세요.',
    unknown: '지원하는 파일은 .gcode 와 .gcode.3mf(.3mf) 예요.',
  };

  // 브라우저 File(또는 Blob+name)을 읽어 결과 반환
  async function importFile(file) {
    const first = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const kind = fileKind(file.name, first);
    if (KIND_ERRORS[kind]) throw new ImportError(KIND_ERRORS[kind], kind);
    if (kind === '3mf') return parse3mf(await file.arrayBuffer());
    const head = await file.slice(0, HEAD_BYTES).text();
    const tail = file.size > HEAD_BYTES ? await file.slice(Math.max(HEAD_BYTES, file.size - TAIL_BYTES)).text() : '';
    return parseGcode(head, tail);
  }

  // 초 → { hours, minutes } (분 반올림, 1초 이상이면 최소 1분)
  function splitTime(seconds) {
    if (!(seconds > 0)) return { hours: 0, minutes: 0 };
    const total = Math.max(1, Math.round(seconds / 60));
    return { hours: Math.floor(total / 60), minutes: total % 60 };
  }

  return {
    ImportError, HEAD_BYTES, TAIL_BYTES,
    parseDuration, detectSlicer, parseGcode, parseSliceInfo,
    listZip, readZipEntry, parse3mf, fileKind, importFile, splitTime,
  };
});
