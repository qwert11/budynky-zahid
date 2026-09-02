// Координаты населённых пунктов ЛУН-лотов новых городов (Nominatim).
// Ключ — "<нас.пункт>|<город-группа>". → data/lun9-geocode.json
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const OUT = D + 'lun9-geocode.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = JSON.parse(fs.readFileSync(D + 'lun9-clean.json', 'utf8'));
const REGION = { 'Хмельницький': 'Хмельницька область', 'Житомир': 'Житомирська область', 'Вінниця': 'Вінницька область' };
const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const CITY = { 'Хмельницький': [49.4229, 26.9871], 'Житомир': [50.2547, 28.6587], 'Вінниця': [49.2331, 28.4682] };

(async () => {
  const want = new Map();
  for (const x of clean) {
    if (!L.inBudget(x.price)) continue;
    const loc = x.loc || x.cityGroup;
    const k = loc + '|' + x.cityGroup;
    if (!want.has(k)) want.set(k, { loc, group: x.cityGroup });
  }
  console.log('локаций:', want.size, '| в кэше:', [...want.keys()].filter(k => cache[k]).length);
  let n = 0;
  for (const [k, { loc, group }] of want) {
    if (cache[k]) continue;
    if (loc === group) { cache[k] = { lat: CITY[group][0], lon: CITY[group][1], src: 'city' }; continue; }
    let hit = null;
    for (const q of [loc + ', ' + REGION[group] + ', Україна', loc + ', Україна']) {
      try {
        const js = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=ua&q=' + encodeURIComponent(q),
          { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } })).json();
        hit = (js || []).find(h => /village|town|city|hamlet|suburb|administrative/.test(h.type || h.addresstype || '')) || (js || [])[0] || null;
      } catch { }
      await sleep(1100);
      if (hit) break;
    }
    cache[k] = hit ? { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), src: 'nom' } : { lat: CITY[group][0], lon: CITY[group][1], src: 'cityfb' };
    n++;
    if (n % 20 === 0) { fs.writeFileSync(OUT, JSON.stringify(cache)); console.log('…', n); }
  }
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log('готово, в кэше', Object.keys(cache).length);
})();
