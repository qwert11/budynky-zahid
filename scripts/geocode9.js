// Геокодирование населённых пунктов нового пула OLX (9 областей) через Nominatim
// с кэшами прошлых сборок. Ключ — "<нас.пункт>|<область>". Если Nominatim не нашёл,
// берём приблизительную точку из объявления (o.map — уровень города/громады).
const fs = require('fs');
const path = require('path');
const SP9 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/09f7008e-ddb2-410c-96d4-ccf69000c0d4/scratchpad/';
const OLD1 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/2ba88487-cdb9-423e-b5e9-69abf018ad10/scratchpad/geocode.json';
const OLD2 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/geocode-flats.json';
const OUT = path.join(__dirname, 'data', 'geocode9.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const cache = fs.existsSync(OUT) ? rd(OUT) : {};
for (const f of [OLD1, OLD2]) {
  if (!fs.existsSync(f)) continue;
  for (const [k, v] of Object.entries(rd(f))) if (v && v.lat && !cache[k]) cache[k] = { lat: +v.lat, lon: +v.lon, src: 'old' };
}

const lots = [];
for (const f of ['olx9-houses.json', 'olx9-flats.json']) lots.push(...Object.values(rd(SP9 + f).items));
const want = new Map();
for (const u of lots) {
  if (!u.loc || !u.region) continue;
  const k = u.loc + '|' + u.region;
  if (!want.has(k)) want.set(k, u);
}
console.log('уникальных локаций:', want.size, '| уже в кэше:', [...want.keys()].filter(k => cache[k]).length);

(async () => {
  let n = 0, miss = 0;
  for (const [k, u] of want) {
    if (cache[k]) continue;
    const [loc, region] = k.split('|');
    let hit = null;
    for (const q of [loc + ', ' + region + ', Україна', loc + ', Україна']) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=ua&q=' + encodeURIComponent(q);
      try {
        const js = await (await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } })).json();
        hit = (js || []).find(h => /village|town|city|hamlet|municipality|suburb|administrative/.test(h.type || h.addresstype || '')) || (js || [])[0] || null;
      } catch { }
      await sleep(1100);
      if (hit) break;
    }
    if (hit) cache[k] = { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), src: 'nom' };
    else if (u.lat && u.lon) { cache[k] = { lat: u.lat, lon: u.lon, src: 'olxmap' }; miss++; }
    else { cache[k] = { lat: null, lon: null, src: 'none' }; miss++; }
    n++;
    if (n % 25 === 0) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(cache)); console.log('…', n, 'обработано, из них без Nominatim', miss); }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log('готово: новых', n, '| фолбэк на точку OLX/пусто:', miss, '| всего в кэше', Object.keys(cache).length);
})();
