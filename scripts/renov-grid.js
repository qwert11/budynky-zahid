// Фотопроверка «получистовая» + «чистовая от застройщика»: сколько реально осталось
// доводить и в какой доле площади (просьба покупателя 08.09.2026: «проверь по картинкам,
// сколько будет стоить ремонт что бы жить — лайт, норм, люкс, и в карточках пропиши»).
//
// По тем же правилам, что nb-grid.js: 4 фото на лот в строку, 8 лотов в сетку
// (4×8 = 32 кадра, 1280×1920). Смотрит Claude и пишет долю площади, которую ещё нужно
// доводить под ключ (frac 0..1) + короткую заметку — в renov-frac.json. Смету в $ по
// трём уровням считает отдельный шаг, renov-compute.js, по этой доле и площади лота.
//
// usage: node renov-grid.js [maxЛотов]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = path.join(__dirname, 'data') + path.sep;
const DIR = path.join(__dirname, 'data', 'vet', 'renov') + path.sep;
const FF = 'D:/soft/video/ffmpeg.exe';
const { semi, raw } = JSON.parse(fs.readFileSync(D + 'units9.json', 'utf8'));
const done = fs.existsSync(D + 'renov-frac.json') ? JSON.parse(fs.readFileSync(D + 'renov-frac.json', 'utf8')) : {};
const MAX = +(process.argv[2] || 999);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151';
const PER_ROW = 4, ROWS = 8, CW = 320, CH = 240;

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const all = [...semi, ...raw];
  const queue = all.filter(u => !done[u.id] && (u.photos || []).length)
    .sort((a, b) => (a.ready === 'raw' ? 0 : 1) - (b.ready === 'raw' ? 0 : 1) || b.quality - a.quality)
    .slice(0, MAX);
  console.log('лотов на проверку:', queue.length, '(получистовая + чистовая от застройщика,', all.length, 'всего)');

  const rows = [], gone = [];
  for (const u of queue) {
    const files = [];
    for (let i = 0; i < Math.min(PER_ROW, u.photos.length); i++) {
      const url = String(u.photos[i]).replace(/;s=\d+x\d+/, ';s=320x240').replace('{width}x{height}', '320x240');
      const file = DIR + u.id + '-' + i + '.jpg';
      if (!fs.existsSync(file)) {
        try {
          const r = await fetch(url, { headers: { 'user-agent': UA } });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 1000 || (buf[0] !== 0xff && buf[0] !== 0x89 && String(buf.slice(0, 4)) !== 'RIFF')) continue;
          fs.writeFileSync(file, buf);
          await sleep(60);
        } catch { continue; }
      }
      files.push(file);
    }
    if (!files.length) { gone.push(u); continue; }
    rows.push({ u, files });
  }
  // Фото недоступны (ссылки протухли) — считаем худший случай: вся площадь под полный
  // ремонт (frac=1), заметка объясняет почему, чтобы не потерялось молча.
  if (gone.length) {
    const frac = fs.existsSync(D + 'renov-frac.json') ? JSON.parse(fs.readFileSync(D + 'renov-frac.json', 'utf8')) : {};
    gone.forEach(u => { frac[u.id] = { frac: 1, note: 'фото недоступны — оценка по умолчанию (вся площадь)' }; });
    fs.writeFileSync(D + 'renov-frac.json', JSON.stringify(frac, null, 1));
    console.log('фото недоступны → frac=1 по умолчанию:', gone.map(u => u.id).join(', '));
  }
  console.log('лотов с фото:', rows.length);

  const manifest = [];
  for (let g = 0; g * ROWS < rows.length; g++) {
    const chunk = rows.slice(g * ROWS, g * ROWS + ROWS);
    const args = ['-y'];
    const cells = [];
    for (const r of chunk) {
      for (let i = 0; i < PER_ROW; i++) cells.push(r.files[i] || null);
    }
    for (let i = chunk.length * PER_ROW; i < ROWS * PER_ROW; i++) cells.push(null);
    for (const c of cells) {
      if (c) args.push('-i', c.replace(/\\/g, '/'));
      else args.push('-f', 'lavfi', '-i', `color=c=#303030:s=${CW}x${CH}`);
    }
    const pre = cells.map((_, i) =>
      `[${i}:v]scale=${CW - 6}:${CH - 6}:force_original_aspect_ratio=increase,crop=${CW - 6}:${CH - 6},pad=${CW}:${CH}:3:3:black,setsar=1[v${i}]`);
    const layout = cells.map((_, i) => `${(i % PER_ROW) * CW}_${Math.floor(i / PER_ROW) * CH}`);
    const fc = pre.join(';') + ';' + cells.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${cells.length}:layout=${layout.join('|')}[out]`;
    const out = DIR + 'renov-' + String(g).padStart(2, '0') + '.png';
    args.push('-filter_complex', fc, '-map', '[out]', '-frames:v', '1', out);
    execFileSync(FF, args, { stdio: 'ignore' });
    manifest.push({
      grid: path.basename(out), ids: chunk.map(r => r.u.id),
      info: chunk.map(r => `${r.u.id} · ${r.u.ready === 'raw' ? 'ЧИСТОВАЯ ОТ ЗАСТРОЙЩИКА' : 'получистовая:' + r.u.semi} · ${r.u.obl} $${r.u.price} ${r.u.area}м² ${r.u.rooms || '?'}к — ${r.u.title}`),
    });
    console.log(out, '←', chunk.length, 'лотов');
  }
  fs.writeFileSync(DIR + 'manifest.json', JSON.stringify(manifest, null, 1));
  console.log('сеток:', manifest.length, '· строк в сетке:', ROWS, '· фото в строке:', PER_ROW);
})();
