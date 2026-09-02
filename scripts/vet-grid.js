// Фото-проверка домов OLX («готовое» = по фотографиям видно жилой дом):
// собирает кандидатов без вердикта в сетки 3×4 (по одному фото на лот, 320×240),
// картинки смотрит Claude и пишет вердикты через vet-apply.js.
// usage: node vet-grid.js [maxPerObl]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = path.join(__dirname, 'data') + path.sep;
const VETDIR = path.join(__dirname, 'data', 'vet') + path.sep;
const FF = 'D:/soft/video/ffmpeg.exe';
const need = JSON.parse(fs.readFileSync(D + 'vet-need.json', 'utf8'));
const done = fs.existsSync(D + 'photo-vet.json') ? JSON.parse(fs.readFileSync(D + 'photo-vet.json', 'utf8')) : {};
const MAX = +(process.argv[2] || 70);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151';

(async () => {
  fs.mkdirSync(VETDIR, { recursive: true });
  const byObl = {};
  for (const u of need) {
    if (done[u.id]) continue;
    if (!u.photos || !u.photos.length) continue;
    (byObl[u.obl] = byObl[u.obl] || []).push(u);
  }
  const queue = [];
  for (const [obl, list] of Object.entries(byObl)) {
    list.sort((a, b) => b.quality - a.quality);
    queue.push(...list.slice(0, MAX));
  }
  console.log('кандидатов на проверку:', queue.length, 'по областям:',
    JSON.stringify(Object.fromEntries(Object.entries(byObl).map(([k, v]) => [k, Math.min(v.length, MAX)]))));

  // скачиваем первое фото каждого лота
  const cells = [];
  for (const u of queue) {
    const url = String(u.photos[0]).replace(/;s=\d+x\d+/, ';s=320x240').replace('{width}x{height}', '320x240');
    const file = VETDIR + u.id + '.jpg';
    if (!fs.existsSync(file)) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': UA } });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 1000 || (buf[0] !== 0xff && buf[0] !== 0x89 && String(buf.slice(0, 4)) !== 'RIFF')) continue; // не картинка
        fs.writeFileSync(file, buf);
        await sleep(80);
      } catch { continue; }
    }
    cells.push(u);
  }
  console.log('скачано фото:', cells.length);

  // сетки 3×4 = 12 лотов: каждый файл отдельным входом (размеры кадров разные,
  // image2-секвенция на таком молча останавливается после первого)
  const manifest = [];
  const PER = 12, CW = 320, CH = 240;
  for (let g = 0; g * PER < cells.length; g++) {
    const chunk = cells.slice(g * PER, g * PER + PER);
    const args = ['-y'];
    for (const u of chunk) args.push('-i', (VETDIR + u.id + '.jpg').replace(/\\/g, '/'));
    for (let i = chunk.length; i < PER; i++) args.push('-f', 'lavfi', '-i', `color=c=gray:s=${CW}x${CH}`);
    const pre = [];
    const layout = [];
    for (let i = 0; i < PER; i++) {
      pre.push(`[${i}:v]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},setsar=1[v${i}]`);
      layout.push(`${(i % 3) * CW}_${Math.floor(i / 3) * CH}`);
    }
    const fc = pre.join(';') + ';' + Array.from({ length: PER }, (_, i) => `[v${i}]`).join('') + `xstack=inputs=${PER}:layout=${layout.join('|')}[out]`;
    const out = VETDIR + 'grid-' + String(g).padStart(2, '0') + '.png';
    args.push('-filter_complex', fc, '-map', '[out]', '-frames:v', '1', out);
    execFileSync(FF, args, { stdio: 'ignore' });
    manifest.push({ grid: path.basename(out), ids: chunk.map(u => u.id), info: chunk.map(u => `${u.obl} $${u.price} ${u.area}м² ${u.km}км ${u.city}`) });
    console.log(out, '←', chunk.map(u => u.id).join(', '));
  }
  fs.writeFileSync(VETDIR + 'manifest.json', JSON.stringify(manifest, null, 1));
  console.log('сеток:', manifest.length);
})();
