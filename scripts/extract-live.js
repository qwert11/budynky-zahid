// Извлекает из живой страницы каталога (index.html) то, что нельзя пересобрать
// скриптами: набор «получистовая» (150 карточек целиком, их сборочная сессия не
// сохранилась) и координаты всех текущих лотов из массива PTS (фолбэк геокодинга).
// → data/live-semi.json, data/live-pts.json
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const s = fs.readFileSync(SRC, 'utf8');

const rows = s.split(/\r?\n/).filter(l => l.startsWith('<div class="row"'));
const attrsOf = L => {
  const a = {};
  for (const m of L.matchAll(/ data-([a-z]+)="([^"]*)"/g)) a[m[1]] = m[2];
  return a;
};

const pm = s.match(/const PTS = (\[[^\n]*\]);/);
if (!pm) { console.error('PTS не найден'); process.exit(1); }
const pts = JSON.parse(pm[1]);
const ptsById = Object.fromEntries(pts.map(p => [p.i, p]));

const semi = [];
for (const L of rows) {
  const a = attrsOf(L);
  if (a.ready !== 'semi') continue;
  const p = ptsById[a.id] || {};
  semi.push({ id: a.id, attrs: a, lat: p.lat ?? null, lon: p.lon ?? null, loc: p.n || null, html: L });
}
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'data', 'live-semi.json'), JSON.stringify(semi));
fs.writeFileSync(path.join(__dirname, 'data', 'live-pts.json'), JSON.stringify(pts));
console.log('строк в живой странице:', rows.length, '| получистовых сохранено:', semi.length, '| точек PTS:', pts.length);
