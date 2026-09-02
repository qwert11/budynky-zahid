// Миниатюры 200×150 для каталога v3: и data URI (артефакт), и внешний URL (Pages).
// Для получистовых URL берётся прямо из перенесённой карточки.
// → data/thumbs9.json, data/thumb-urls9.json
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const { units, semi } = JSON.parse(fs.readFileSync(D + 'units9.json', 'utf8'));
const OUT_DATA = D + 'thumbs9.json', OUT_URL = D + 'thumb-urls9.json';
const D5 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/';
const D2 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/2ba88487-cdb9-423e-b5e9-69abf018ad10/scratchpad/';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const ex = f => fs.existsSync(f);
const data = ex(OUT_DATA) ? rd(OUT_DATA) : {};
const urls = ex(OUT_URL) ? rd(OUT_URL) : {};
const oldData = { ...(ex(D2 + 'thumbs.json') ? rd(D2 + 'thumbs.json') : {}), ...(ex(D5 + 'thumbs2.json') ? rd(D5 + 'thumbs2.json') : {}) };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function thumbUrl(u) {
  if (u.html) { const m = u.html.match(/<img src="(https:[^"]+)"/); return m ? m[1] : null; }
  const p = u.photoUrl || (u.photos || [])[0];
  if (!p) return null;
  if (/olxcdn/.test(p)) return String(p).replace(/;s=\d+x\d+/, ';s=200x150').replace('{width}x{height}', '200x150');
  if (/lunstatic/.test(p)) return String(p).replace(/\/lun-ua\/\d+\/\d+\//, '/lun-ua/200/150/');
  return p;
}

(async () => {
  const all = [...units, ...semi];
  const targets = all.filter(u => !data[u.id] && !oldData[u.id] && thumbUrl(u));
  console.log('лотов:', all.length, '| миниатюр к загрузке:', targets.length);
  let ok = 0, bad = 0, bytes = 0;
  const CONC = 6;
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async u => {
      const url = thumbUrl(u);
      for (let t = 0; t < 3; t++) {
        try {
          const r = await fetch(url, { headers: { 'user-agent': UA } });
          if (!r.ok) { await sleep(400); continue; }
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 500) { bad++; return; }
          const mime = /\.png($|\?)/i.test(url) ? 'image/png' : 'image/jpeg';
          data[u.id] = 'data:' + mime + ';base64,' + buf.toString('base64');
          urls[u.id] = url;
          bytes += buf.length; ok++;
          return;
        } catch { await sleep(500); }
      }
      bad++;
    }));
    if ((i / CONC) % 10 === 0) {
      fs.writeFileSync(OUT_DATA, JSON.stringify(data));
      fs.writeFileSync(OUT_URL, JSON.stringify(urls));
      console.log(`  ${Math.min(i + CONC, targets.length)}/${targets.length} | скачано ${ok}, ошибок ${bad}, ${(bytes / 1048576).toFixed(2)} МБ`);
    }
    await sleep(120);
  }
  // внешние URL нужны и тем, у кого data URI уже был в старых кэшах
  for (const u of all) if (!urls[u.id] && thumbUrl(u)) urls[u.id] = thumbUrl(u);
  fs.writeFileSync(OUT_DATA, JSON.stringify(data));
  fs.writeFileSync(OUT_URL, JSON.stringify(urls));
  console.log(`готово: новых ${ok}, ошибок ${bad}, вес новых ${(bytes / 1048576).toFixed(2)} МБ`);
})();
