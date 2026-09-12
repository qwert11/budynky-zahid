// Metrazh.com.ua: фильтр цены — GET p[c]=USD&p[f]=<от>&p[t]=<до> прямо на странице
// категории города (без JS/браузера). Карточка поиска не отдаёт координаты — только
// город и район текстом («Львов, Шевченковский»), поэтому первичная точка — центр
// города поиска (как раньше у Телеграма); addr9.js на следующем прогоне units9.js
// уточнит её по улице из заголовка/описания объявления тем же механизмом, что у OLX.
//
// Замечание покупателя 07.09.2026 по скриншоту конкретного лота: часть объявлений
// Metrazh — зеркала OLX. Продавец «скрыл контакты», и вместо номера страница отдаёт
// текст «зв'язатися можна за посиланням» со ссылкой на оригинал olx.ua; на выборке
// 12 объявлений так помечена половина, и у 4 из 6 таких OLX-оригинал уже снят (410).
// Раз это тот же лот, что уже приходит из olx9-houses/flats.json, зеркало не даёт
// новой площади рынка — оно либо мёртвое (продавец снял оригинал, а Metrazh не
// подчистил копию), либо просто задваивает то, что и так есть в наборе OLX. Поэтому
// каждый кандидат проверяется по странице объявления, и зеркала (живые и мёртвые
// одинаково) выбрасываются целиком, а не только с погибшим оригиналом.
// → data/metrazh9-candidates.json (формат loadExt() в units9.js).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [city-slug, украинское название, зона — как в OBL_ZONE units9.js, центр города lat/lon]
const CITY = {
  vol: ['lutsk', 'Луцьк', 'Волынь', 50.7472, 25.3254],
  rov: ['rovno', 'Рівне', 'Ровенщина', 50.6199, 26.2516],
  lv: ['lvov', 'Львів', 'Львовщина', 49.8397, 24.0297],
  ter: ['ternopol', 'Тернопіль', 'Тернопольщина', 49.5535, 25.5948],
  if: ['ivano-frankovsk', 'Івано-Франківськ', 'Прикарпатье', 48.9226, 24.7111],
  chv: ['chernovtsy', 'Чернівці', 'Буковина', 48.2915, 25.9403],
  khm: ['khmelnitskiy', 'Хмельницький', 'Хмельниччина', 49.4229, 26.9871],
  zht: ['zhitomir', 'Житомир', 'Житомирщина', 50.2547, 28.6587],
  vin: ['vinnitsa', 'Вінниця', 'Винничина', 49.2331, 28.4682],
};
const TYPES = { kvartiry: 'flat', doma: 'house' };
const MAXPAGE = 20;
const ROOMS_W = [[/^Однокомнатн|^Студ/i, 1], [/^Двухкомнатн/i, 2], [/^Тр[её]хкомнатн/i, 3],
  [/^Четыр[её]хкомнатн/i, 4], [/^Пятикомнатн/i, 5], [/^Шестикомнатн/i, 6]];
const roomsOf = t => { for (const [re, n] of ROOMS_W) if (re.test(t || '')) return n; return null; };

async function fetchHtml(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ru' } });
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(2000 * (t + 1)); }
  }
  return null;
}
// только статус — для проверки живости зеркала OLX (404/410 = снято, как в check-dead.mjs)
async function fetchStatus(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept': '*/*', 'accept-language': 'uk-UA,uk;q=0.9' } });
    await r.arrayBuffer().catch(() => {});
    return r.status;
  } catch { return 0; }
}

const MONTH_RU = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
function parseDateRu(s) {
  const m = /(\d{1,2})\s+([а-я]+)\s+(\d{4})/i.exec(s || '');
  if (!m || !MONTH_RU[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTH_RU[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
// Зеркало OLX: продавец скрыл контакты, страница вместо телефона отдаёт
// «связатся … можно по <a href="…olx.ua…">ссылке</a>»
function detailInfo(html) {
  const dateM = /(?:Додано|Добавлено):\s*([^<]+)</.exec(html || '');
  const mirrorM = /(?:по|за)\s+<a[^>]*href="(https:\/\/www\.olx\.ua\/[^"]+)"/i.exec(html || '');
  return { date: dateM ? parseDateRu(dateM[1]) : null, mirror: mirrorM ? mirrorM[1] : null };
}

function parseCards(html) {
  const starts = [...html.matchAll(/<div class="sr-2-list-item-n">/g)].map(m => m.index);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    const chunk = html.slice(starts[i], end);
    const linkM = /href="(https:\/\/metrazh\.com\.ua\/[^"]+-(\d+)\.html)"/.exec(chunk);
    if (!linkM) continue;
    const titleM = /sr-2-list-item-n-title">\s*<a[^>]*>([^<]*)</.exec(chunk);
    const roomsTxt = (/class="rooms">([^<]*)</.exec(chunk) || [])[1] || '';
    const areaM = /class="area">([\d.,]+)\s*м/.exec(chunk);
    const landM = /class="l-area">([\d.,]+)\s*сот/.exec(chunk);
    const floorM = /class="floor">(\d+)\s*\/\s*(\d+)\s*эт/.exec(chunk);
    const priceM = /class="price"><strong>([\d\s]+)\s*\$/.exec(chunk);
    const addrM = /sr-2-item-address">\s*([^<]*)</.exec(chunk);
    const descM = /sr-2-item-desc[^"]*">\s*([\s\S]*?)\s*<\/div>/.exec(chunk);
    const photoM = /data-src="(https:\/\/metrazh\.com\.ua\/files\/images\/[^"]+\.jpe?g)"/.exec(chunk);
    if (!priceM) continue; // цена не в $ — пропускаем
    out.push({
      id: 'METR' + linkM[2], link: linkM[1],
      title: titleM ? titleM[1].trim() : '',
      rooms: roomsOf(roomsTxt),
      area: areaM ? +areaM[1].replace(',', '.') : null,
      land: landM ? +landM[1].replace(',', '.') : null,
      floor: floorM ? +floorM[1] : null, floors: floorM ? +floorM[2] : null,
      price: +priceM[1].replace(/\s/g, ''),
      address: addrM ? addrM[1].trim() : '',
      desc: descM ? descM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) : '',
      photo: photoM ? photoM[1] : null,
    });
  }
  return out;
}

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = {};
  const stats = { pages: 0, raw: 0, kept: 0, byObl: {} };
  for (const [obl, [slug, cityUa, zone, lat, lon]] of Object.entries(CITY)) {
    for (const [typePath, kind] of Object.entries(TYPES)) {
      let list = [];
      for (let page = 1; page <= MAXPAGE; page++) {
        const url = `https://metrazh.com.ua/${slug}/prodazha/${typePath}/?page=${page}&p[c]=USD&p[f]=${L.BUDGET_LO}&p[t]=${L.BUDGET_HI}`;
        const html = await fetchHtml(url);
        stats.pages++;
        await sleep(1800 + Math.random() * 900);
        if (!html) break;
        const cards = parseCards(html);
        if (!cards.length) break;
        list = list.concat(cards);
        if (cards.length < 20) break; // последняя страница
      }
      stats.raw += list.length;
      for (const c of list) {
        if (!(c.price >= L.BUDGET_LO && c.price <= L.BUDGET_HI)) continue;
        const txt = c.title + ' ' + c.desc;
        if (kind === 'house' && (c.area || 0) < 65) continue;
        if (kind === 'flat' && ((c.area || 0) < 50 || (c.rooms != null && c.rooms < 2))) continue;
        if (L.SHARE.test(txt)) continue;
        if (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt)) continue;
        store[c.id] = {
          id: c.id, kind, title: c.title || c.address || cityUa, url: c.link, price: c.price,
          area: c.area, land: c.land, rooms: c.rooms, floor: c.floor, floors: c.floors,
          loc: cityUa, zone, lat, lon, locExact: false,
          date: null, photoList: c.photo ? [c.photo] : [], text: c.desc,
        };
        stats.kept++;
        stats.byObl[obl] = (stats.byObl[obl] || 0) + 1;
      }
    }
  }
  console.log('metrazh9: страниц', stats.pages, '| карточек всего', stats.raw, '| в бюджете и по правилам', stats.kept);
  console.log('по областям:', stats.byObl);

  // Проверка зеркал OLX по странице каждого объявления (см. комментарий в шапке файла)
  const cand = Object.values(store);
  let mirrorDead = 0, mirrorLive = 0, checked = 0, failed = 0;
  const final = [];
  for (const c of cand) {
    const html = await fetchHtml(c.url);
    checked++;
    if (!html) { failed++; continue; } // страница не открылась — не уверены, пропускаем
    const { date, mirror } = detailInfo(html);
    if (mirror) {
      const st = await fetchStatus(mirror);
      if (st === 404 || st === 410) mirrorDead++; else mirrorLive++;
      await sleep(700);
      continue; // зеркало — живое или мёртвое, роли не играет: не новый лот
    }
    c.date = date;
    final.push(c);
    if (checked % 40 === 0) console.log('  проверено', checked, '/', cand.length);
    await sleep(1500 + Math.random() * 700);
  }
  fs.writeFileSync(D + 'metrazh9-candidates.json', JSON.stringify(final));
  const finalByObl = {};
  const OBL_OF_ZONE = Object.fromEntries(Object.entries(CITY).map(([o, v]) => [v[2], o]));
  for (const c of final) { const o = OBL_OF_ZONE[c.zone] || '?'; finalByObl[o] = (finalByObl[o] || 0) + 1; }
  console.log('metrazh9 проверка зеркал: проверено', checked, '| зеркал OLX — мёртвых', mirrorDead, ', живых', mirrorLive,
    '| не открылось', failed, '| независимых лотов оставлено', final.length);
  console.log('итоговые по областям:', finalByObl);
})();
