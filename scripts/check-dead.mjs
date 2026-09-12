// Проверяет доступность всех объявлений каталога (любой источник) и обновляет dead.json.
// Запускается GitHub Actions по расписанию; можно и локально: node scripts/check-dead.mjs
// Правда о снятии объявления — HTTP-статус его страницы: 404/410 = снято.
import fs from 'node:fs';
import { createRequire } from 'node:module';
// OLX отвечает Node-у 403 по TLS-отпечатку, поэтому статусы снимаем системным curl
const { curlStatus } = createRequire(import.meta.url)('./olx-fetch.js');

const html = fs.readFileSync('index.html', 'utf8');
// \r? — локально index.html лежит с CRLF (core.autocrlf), на раннере GitHub Actions с LF
const pts = JSON.parse(html.match(/const PTS = (\[.*?\]);\r?\n/s)[1]);
const prev = fs.existsSync('dead.json') ? JSON.parse(fs.readFileSync('dead.json', 'utf8')) : { dead: [] };
const prevDead = new Set(prev.dead);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Обычный запрос — для всех источников, кроме OLX.
async function fetchStatus(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept': '*/*', 'accept-language': 'uk-UA,uk;q=0.9' }, redirect: 'follow' });
      await r.arrayBuffer().catch(() => {});
      if (r.status === 429 || r.status >= 500) { await sleep(700 * (t + 1)); continue; }
      return r.status;
    } catch { await sleep(700 * (t + 1)); }
  }
  return 0;
}

// Статус страницы объявления: 404/410 = снято, 200 = живо, 0 = проверить не удалось.
// Транспорт выбирается по домену: OLX блокирует TLS-отпечаток Node и требует curl,
// а rieltor.ua, dom.ria.com и flatfy, наоборот, curl не отвечают — им нужен обычный fetch.
const status = (url) => /(^|\.)olx\.ua/i.test(new URL(url).hostname) ? curlStatus(url) : fetchStatus(url);

const dead = new Set();
let blocked = [];
let checked = 0;
const byId = new Map(pts.map(p => [p.i, p]));

for (let i = 0; i < pts.length; i += 6) {
  await Promise.all(pts.slice(i, i + 6).map(async p => {
    const st = await status(p.u);
    checked++;
    if (st === 404 || st === 410) dead.add(p.i);
    else if (st === 200) { /* живо */ }
    else { blocked.push(p.i + ':' + st); if (prevDead.has(p.i)) dead.add(p.i); } // ошибка/блок — статус не меняем
  }));
}

// Второй проход по непроверенным: rieltor.ua отдаёт пустой ответ, когда его дёргают
// в шесть потоков, а по одному с паузой отвечает нормально. Здесь же добиваются лоты,
// у которых в первом проходе была сетевая ошибка.
if (blocked.length) {
  console.log(`второй проход по ${blocked.length} непроверенным, по одному…`);
  const again = [];
  for (const rec of blocked) {
    const id = rec.slice(0, rec.lastIndexOf(':'));
    const p = byId.get(id);
    if (!p) { again.push(rec); continue; }
    const st = await status(p.u);
    if (st === 404 || st === 410) { dead.add(id); }
    else if (st === 200) { dead.delete(id); }       // живо: снимаем ошибочную пометку из первого прохода
    else { again.push(id + ':' + st); }
    await sleep(250);
  }
  blocked = again;
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
