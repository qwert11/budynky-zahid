// Контуры 9 областей каталога с Nominatim: SVG-path в «старой» системе координат
// карты (X=(lon-21.9)*123.3+20, Y=(51.15-lat)*187.5+20) + упрощённые полигоны
// в градусах (geo) для привязки лотов к области точкой. → data/oblast-shapes9.json
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'data', 'oblast-shapes9.json');
const wx = lon => (lon - 21.9) * 123.3 + 20;
const wy = lat => (51.15 - lat) * 187.5 + 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// [название для Nominatim, подпись на карте, slug фильтра, широта/долгота подписи]
const OBLASTS = [
  ['Волинська', 'Волынь', 'vol', 51.05, 25.05],
  ['Рівненська', 'Ровенщина', 'rov', 51.10, 26.60],
  ['Львівська', 'Львовщина', 'lv', 49.88, 23.25],
  ['Тернопільська', 'Тернопольщина', 'ter', 49.12, 25.55],
  ['Івано-Франківська', 'Прикарпатье', 'if', 48.44, 24.42],
  ['Чернівецька', 'Буковина', 'chv', 48.12, 26.45],
  ['Хмельницька', 'Хмельниччина', 'khm', 49.30, 27.00],
  ['Житомирська', 'Житомирщина', 'zht', 50.65, 28.45],
  ['Вінницька', 'Винничина', 'vin', 48.85, 28.60],
];
const ringsOf = g => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
const toPath = rings => rings.filter(r => r.length > 12).map(r => {
  const step = Math.max(1, Math.floor(r.length / 220));
  const pts = r.filter((_, i) => i % step === 0);
  return 'M' + pts.map(([lon, lat]) => wx(lon).toFixed(1) + ' ' + wy(lat).toFixed(1)).join('L') + 'Z';
}).join('');
const simplify = rings => rings.filter(r => r.length > 40).map(r => {
  const step = Math.max(1, Math.floor(r.length / 260));
  return r.filter((_, i) => i % step === 0).map(([lon, lat]) => [+lon.toFixed(4), +lat.toFixed(4)]);
});

(async () => {
  const out = [];
  for (const [obl, label, slug, llat, llon] of OBLASTS) {
    let done = false;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&polygon_geojson=1&polygon_threshold=0.012&countrycodes=ua&q=' + encodeURIComponent(obl + ' область, Україна');
    let js = null;
    for (let t = 0; t < 5 && !js; t++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
        const txt = await r.text();
        if (!r.ok || txt[0] !== '[') { console.log(obl, 'ответ не JSON (', r.status, ') — жду'); await sleep(15000 * (t + 1)); continue; }
        js = JSON.parse(txt);
      } catch (e) { console.log(obl, 'err', String(e).slice(0, 60)); await sleep(15000 * (t + 1)); }
    }
    if (!js) { console.error(obl, 'Nominatim недоступен'); process.exit(1); }
    for (const hit of js) {
      if (!hit.geojson || !/Polygon/.test(hit.geojson.type)) continue;
      const rings = ringsOf(hit.geojson);
      const p = toPath(rings);
      if (p.length < 200) continue;
      out.push({ name: label, slug, path: p, lx: +wx(llon).toFixed(1), ly: +wy(llat).toFixed(1), geo: simplify(rings) });
      console.log(obl, 'ok, path', p.length, 'B, колец', rings.length);
      done = true; break;
    }
    if (!done) { console.error(obl, 'NOT FOUND'); process.exit(1); }
    await sleep(1200);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('saved', out.length, 'областей,', (JSON.stringify(out).length / 1024).toFixed(0), 'КБ →', OUT);
})();
