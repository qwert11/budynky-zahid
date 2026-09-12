// Реестр «когда лот впервые появился у нас» — data/first-seen.json.
//
// Просьба покупателя 11.09.2026: у объявления должно быть видно две даты, и по обеим
// нужны сортировка и фильтр — (1) когда объявление разместили на источнике (она уже
// есть, это createdTime, плашка даты на карточке) и (2) когда лот подтянулся в наш
// каталог очередным парсингом. Второй даты в данных не было вовсе: сырые базы OLX
// накопительные (store.items дополняется каждым прогоном и перезаписывается), а даты
// своего сбора лот не носит, поэтому «новое у нас» неоткуда было взять.
//
// Что считается появлением у нас: попадание в КАТАЛОГ (units/semi/raw в units9.json),
// а не в сырую базу. Лот, который неделю лежал в выдаче OLX, но не проходил в топ-50,
// для покупателя не существовал; днём появления честно считается день, когда он стал
// виден на сайте. По этой же причине источником истории служат сами сборки каталога.
//
// Бэкфилл (разовый, при первом запуске): git-история index.html — 70 коммитов с 25.08.2026.
// В каждой сборке лежит массив PTS (точки карты, у каждой id объявления), поэтому для
// каждого id берётся дата самого раннего коммита, где он встречается. Это точные даты,
// а не оценка: коммит = день, когда лот реально был на сайте. Лоты, которых нет ни
// в одной прошлой сборке, считаются появившимися в текущем прогоне.
//
// Дальше реестр ведётся сам: каждый прогон дописывает только новые id, уже известные
// даты не трогаются никогда (иначе лот «молодел» бы при каждой пересборке).
//
// usage: node scripts/first-seen.js [--date YYYY-MM-DD] [--rebuild]
//   --date    дата прогона (по умолчанию сегодня)
//   --rebuild перестроить реестр с нуля, заново пройдя git-историю
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const D = path.join(__dirname, 'data') + path.sep;
const ROOT = path.join(__dirname, '..');
const OUT = D + 'first-seen.json';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const argv = process.argv.slice(2);
const REBUILD = argv.includes('--rebuild');
const di = argv.indexOf('--date');
const TODAY = di >= 0 && argv[di + 1] ? argv[di + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) { console.error('дата прогона: YYYY-MM-DD'); process.exit(2); }

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// id объявлений из сборки каталога: массив PTS точек карты
function idsOfBuild(html) {
  const m = html.match(/const PTS\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!m) return null;
  let arr;
  try { arr = JSON.parse(m[1]); } catch { return null; }
  return arr.map(p => p && p.i).filter(Boolean);
}

function backfill() {
  // от старых коммитов к новым: первая встреча id и есть дата появления
  const log = git(['log', '--format=%H %ad', '--date=short', '--reverse', '--', 'index.html'])
    .trim().split('\n').filter(Boolean).map(l => l.split(' '));
  const seen = {};
  const builds = [];
  for (const [hash, date] of log) {
    let html;
    try { html = git(['show', `${hash}:index.html`]); } catch { continue; }
    const ids = idsOfBuild(html);
    if (!ids) { console.log(`  ${date} ${hash.slice(0, 7)}: PTS не разобрался, пропуск`); continue; }
    let fresh = 0;
    for (const id of ids) if (!seen[id]) { seen[id] = date; fresh++; }
    builds.push({ date, hash: hash.slice(0, 7), n: ids.length, fresh });
    console.log(`  ${date} ${hash.slice(0, 7)}: в сборке ${ids.length}, впервые ${fresh}`);
  }
  return { seen, builds };
}

let reg = (!REBUILD && fs.existsSync(OUT)) ? rd(OUT) : null;
if (!reg) {
  console.log('бэкфилл по git-истории index.html:');
  const { seen, builds } = backfill();
  reg = { updated: '', backfilled: true, runs: [...new Set(builds.map(b => b.date))].sort(), seen };
  console.log(`бэкфилл: ${Object.keys(seen).length} лотов из ${builds.length} сборок\n`);
}

// текущая сборка каталога: всё, чего нет в реестре, появилось сегодня
const u9 = rd(D + 'units9.json');
const cur = [...(u9.units || []), ...(u9.semi || []), ...(u9.raw || [])].map(x => x.id).filter(Boolean);
const before = Object.keys(reg.seen).length;
let fresh = 0;
for (const id of cur) if (!reg.seen[id]) { reg.seen[id] = TODAY; fresh++; }

reg.updated = TODAY;
reg.runs = [...new Set([...(reg.runs || []), TODAY])].sort();

// сводка по дням для текущего каталога
const byDay = {};
for (const id of cur) { const d = reg.seen[id]; byDay[d] = (byDay[d] || 0) + 1; }

fs.writeFileSync(OUT, JSON.stringify(reg));
console.log(`в каталоге ${cur.length} лотов; впервые у нас сегодня (${TODAY}): ${fresh}`);
console.log(`реестр: было ${before}, стало ${Object.keys(reg.seen).length} записей → ${path.relative(ROOT, OUT)}`);
console.log('по дням появления (текущий каталог):');
for (const d of Object.keys(byDay).sort().reverse()) console.log(`  ${d}: ${byDay[d]}`);
