// Применяет вердикты фото-проверки: node vet-apply.js '{"ID123":"ok","ID456":"no"}'
// или node vet-apply.js grid-00 ok,no,ok,... (12 вердиктов в порядке ячеек сетки,
// слева направо, сверху вниз; допустимы ok / no / ? )
// Сетки новостроек (nb-00 …) — оттуда же, но в них строка = один лот, 8 вердиктов
// сверху вниз; манифест лежит в data/vet/nb/.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const OUT = D + 'photo-vet.json';
const vet = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const a = process.argv[2];
if (!a) { console.error('нет аргумента'); process.exit(2); }
if (a.startsWith('{')) {
  Object.assign(vet, JSON.parse(a));
} else {
  const mf = a.startsWith('nb-') ? 'vet/nb/manifest.json' : 'vet/manifest.json';
  const manifest = JSON.parse(fs.readFileSync(D + mf, 'utf8'));
  const m = manifest.find(x => x.grid.startsWith(a));
  if (!m) { console.error('сетка не найдена:', a); process.exit(2); }
  const verdicts = process.argv[3].split(',').map(s => s.trim());
  m.ids.forEach((id, i) => { if (verdicts[i] && verdicts[i] !== '?') vet[id] = verdicts[i]; });
}
fs.writeFileSync(OUT, JSON.stringify(vet, null, 1));
const c = { ok: 0, no: 0 };
Object.values(vet).forEach(v => c[v] = (c[v] || 0) + 1);
console.log('вердиктов всего:', Object.keys(vet).length, JSON.stringify(c));
