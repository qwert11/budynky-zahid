// Промышленные зоны из OpenStreetMap (Overpass): полигоны landuse=industrial и
// landuse=quarry по 9 областям. Площадь считается по геометрии (шнуровка с поправкой
// на широту), потом агрегируется в ячейки сетки ~4×4 км — для слоя карты каталога.
// Источник данных: © участники OpenStreetMap (ODbL). Результат: data/industry.json
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'data', 'industry.json');
const RAWDIR = path.join(__dirname, 'data', 'industry-raw');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OBLASTS = [
  ['UA-07', 'Волинська'], ['UA-56', 'Рівненська'], ['UA-46', 'Львівська'],
  ['UA-61', 'Тернопільська'], ['UA-26', 'Івано-Франківська'], ['UA-77', 'Чернівецька'],
  ['UA-68', 'Хмельницька'], ['UA-18', 'Житомирська'], ['UA-05', 'Вінницька'],
];
const EP = 'https://overpass-api.de/api/interpreter';

// площадь кольца [lon,lat][] в м² (шнуровка на локальной проекции)
function ringArea(r) {
  if (r.length < 3) return 0;
  const lat0 = r[0][1] * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0), my = 110540;
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    s += (x1 * mx) * (y2 * my) - (x2 * mx) * (y1 * my);
  }
  return Math.abs(s / 2);
}
function centroid(r) {
  let lon = 0, lat = 0;
  for (const [x, y] of r) { lon += x; lat += y; }
  return [lon / r.length, lat / r.length];
}

async function fetchOblast(iso, name) {
  const cache = path.join(RAWDIR, iso + '.json');
  if (fs.existsSync(cache)) { console.log(name, '— из кэша'); return JSON.parse(fs.readFileSync(cache, 'utf8')); }
  const q = `[out:json][timeout:300];
area["ISO3166-2"="${iso}"]->.a;
( way["landuse"~"^(industrial|quarry)$"](area.a);
  relation["landuse"~"^(industrial|quarry)$"](area.a); );
out tags geom;`;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(EP, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
      if (!r.ok) { console.log(name, 'HTTP', r.status, '— повтор'); await sleep(30000 * (t + 1)); continue; }
      const j = await r.json();
      fs.mkdirSync(RAWDIR, { recursive: true });
      fs.writeFileSync(cache, JSON.stringify(j));
      return j;
    } catch (e) { console.log(name, 'err', String(e).slice(0, 80)); await sleep(30000 * (t + 1)); }
  }
  throw new Error('Overpass не отдал ' + name);
}

(async () => {
  const cells = new Map(); // ключ ячейки → {a: м², q: м² карьеров}
  const CLON = 0.06, CLAT = 0.04; // ~4.3 × 4.4 км
  let zones = 0;
  for (const [iso, name] of OBLASTS) {
    const j = await fetchOblast(iso, name);
    let oblA = 0, n = 0;
    for (const el of j.elements || []) {
      let rings = [];
      if (el.type === 'way' && el.geometry) rings = [el.geometry.map(g => [g.lon, g.lat])];
      else if (el.type === 'relation' && el.members) {
        rings = el.members.filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(g => [g.lon, g.lat]));
      }
      for (const r of rings) {
        const a = ringArea(r);
        if (a < 3000) continue; // мельче 0,3 га — шум
        const [lon, lat] = centroid(r);
        const key = Math.round(lon / CLON) + ':' + Math.round(lat / CLAT);
        const c = cells.get(key) || { lon: Math.round(lon / CLON) * CLON, lat: Math.round(lat / CLAT) * CLAT, a: 0, q: 0 };
        c.a += a;
        if ((el.tags || {}).landuse === 'quarry') c.q += a;
        cells.set(key, c);
        oblA += a; n++; zones++;
      }
    }
    console.log(`${name}: ${n} зон, ${(oblA / 1e6).toFixed(1)} км²`);
    await sleep(8000);
  }
  const out = [...cells.values()]
    .map(c => ({ lat: +c.lat.toFixed(3), lon: +c.lon.toFixed(3), km2: +(c.a / 1e6).toFixed(3), qk2: +(c.q / 1e6).toFixed(3) }))
    .filter(c => c.km2 >= 0.03)
    .sort((x, y) => y.km2 - x.km2);
  fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), source: 'OpenStreetMap landuse=industrial|quarry', cells: out }));
  console.log(`итого зон ${zones}, ячеек ${out.length}, максимум ${out[0] && out[0].km2} км² →`, OUT);
})();
