// Проверяет доступность всех объявлений каталога на OLX и обновляет dead.json.
// Запускается GitHub Actions по расписанию; можно и локально: node scripts/check-dead.mjs
// Правда о снятии объявления — HTTP-статус его страницы: 404/410 = снято.
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const html = fs.readFileSync('index.html', 'utf8');
const pts = JSON.parse(html.match(/const PTS = (\[.*?\]);\n/s)[1]);
const prev = fs.existsSync('dead.json') ? JSON.parse(fs.readFileSync('dead.json', 'utf8')) : { dead: [] };
const prevDead = new Set(prev.dead);

async function status(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'uk-UA,uk;q=0.9' }, redirect: 'follow' });
    // тело не нужно, но соединение надо освободить
    await r.arrayBuffer().catch(() => {});
    return r.status;
  } catch { return 0; }
}

const dead = new Set(), blocked = [];
let checked = 0;
for (let i = 0; i < pts.length; i += 6) {
  await Promise.all(pts.slice(i, i + 6).map(async p => {
    const st = await status(p.u);
    checked++;
    if (st === 404 || st === 410) dead.add(p.i);
    else if (st === 200) { /* живо */ }
    else { blocked.push(p.i + ':' + st); if (prevDead.has(p.i)) dead.add(p.i); } // ошибка/блок — статус не меняем
  }));
}
console.log(`проверено ${checked}, недоступно ${dead.size}, ошибок/блокировок ${blocked.length}`);
if (blocked.length) console.log('не удалось проверить:', blocked.join(' '));

// если OLX заблокировал раннер (сплошные не-200/404), ничего не трогаем
if (blocked.length > pts.length / 2) {
  console.log('слишком много ошибок — похоже на блокировку, dead.json не обновляю');
  process.exit(0);
}

const list = [...dead].sort();
if (JSON.stringify(list) === JSON.stringify([...prevDead].sort())) {
  console.log('список не изменился');
  process.exit(0);
}
fs.writeFileSync('dead.json', JSON.stringify({ checked: new Date().toISOString().slice(0, 10), dead: list }) + '\n');
console.log('dead.json обновлён:', list.join(' '));
