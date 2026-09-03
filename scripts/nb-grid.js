// Фотопроверка новостроек: «живые фото готового жилья» или «чистовая».
//
// Правило покупателя 03.09.2026: новострой чистовая игнорируется, а готовый новострой
// идёт первым в каталоге. Текстом это не отличить (у «под чистову» поле «Ремонт» пустое),
// поэтому решают фотографии. Метка OLX «Новобудова» сама по себе не значит ничего.
//
// Скрипт собирает по 4 фото на лот в одну строку и складывает 8 лотов в сетку
// (4×8 = 32 кадра, 1280×1920). Картинки смотрит Claude и пишет вердикты через
// vet-apply.js — тот же файл photo-vet.json, что и у домов: вопрос тот же
// («на фото жильё, в которое можно заехать?»), поэтому вердикт один на лот.
//
//   ok — виден жилой интерьер: пол, обои или краска, двери, кухня, мебель
//   no — бетон, стяжка, штукатурка; только планировка; только рендер; только фасад
//
// usage: node nb-grid.js [maxЛотов]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = path.join(__dirname, 'data') + path.sep;
const DIR = path.join(__dirname, 'data', 'vet', 'nb') + path.sep;
const FF = 'D:/soft/video/ffmpeg.exe';
const need = JSON.parse(fs.readFileSync(D + 'nb-need.json', 'utf8'));
const done = fs.existsSync(D + 'photo-vet.json') ? JSON.parse(fs.readFileSync(D + 'photo-vet.json', 'utf8')) : {};
const MAX = +(process.argv[2] || 999);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151';
const PER_ROW = 4, ROWS = 8, CW = 320, CH = 240;

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  // порядок проверки — от лучшего индекса: эти лоты и стоят в топах областей
  const queue = need.filter(u => !done[u.id] && (u.photos || []).length)
    .sort((a, b) => b.quality - a.quality).slice(0, MAX);
  console.log('новостроек на проверку:', queue.length);

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
  // Фото не отдаются (у Телеграма ссылки на cdn.telesco.pe живут недолго и отвечают 404):
  // смотреть нечего, а «нет живых фото» — это и есть вердикт no. Иначе лот навсегда
  // остался бы в очереди на проверку и молча не попадал ни в один список.
  if (gone.length) {
    const vet = JSON.parse(fs.readFileSync(D + 'photo-vet.json', 'utf8'));
    gone.forEach(u => { vet[u.id] = 'no'; });
    fs.writeFileSync(D + 'photo-vet.json', JSON.stringify(vet, null, 1));
    console.log('фото недоступны → вердикт no:', gone.map(u => u.id).join(', '));
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
    // рамка вокруг кадра, чтобы строка (= один лот) читалась как строка
    const pre = cells.map((_, i) =>
      `[${i}:v]scale=${CW - 6}:${CH - 6}:force_original_aspect_ratio=increase,crop=${CW - 6}:${CH - 6},pad=${CW}:${CH}:3:3:black,setsar=1[v${i}]`);
    const layout = cells.map((_, i) => `${(i % PER_ROW) * CW}_${Math.floor(i / PER_ROW) * CH}`);
    const fc = pre.join(';') + ';' + cells.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${cells.length}:layout=${layout.join('|')}[out]`;
    const out = DIR + 'nb-' + String(g).padStart(2, '0') + '.png';
    args.push('-filter_complex', fc, '-map', '[out]', '-frames:v', '1', out);
    execFileSync(FF, args, { stdio: 'ignore' });
    manifest.push({
      grid: path.basename(out), ids: chunk.map(r => r.u.id),
      info: chunk.map(r => `${r.u.obl} $${r.u.price} ${r.u.area}м² ${r.u.rooms || '?'}к ${r.u.floor || '?'}/${r.u.floors || '?'} q${r.u.quality} ${r.u.city} — ${r.u.title}`),
    });
    console.log(out, '←', chunk.length, 'лотов');
  }
  fs.writeFileSync(DIR + 'manifest.json', JSON.stringify(manifest, null, 1));
  console.log('сеток:', manifest.length, '· строк в сетке:', ROWS, '· фото в строке:', PER_ROW);
})();
