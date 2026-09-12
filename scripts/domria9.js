// dom.ria.com — крупнейшая площадка недвижимости Украины, независимая база (не зеркало
// и не тот же движок, что у lun.ua/rieltor.ua, хотя тоже LUN Group). У SSR-страницы
// категории (/uk/prodazha-domov/{город}/) фильтр цены не работает через query — Vue-
// приложение отдаёт один и тот же несортированный список независимо от price_from/
// price_to в URL (проверено: 164 карточки что с фильтром, что без). Рабочий путь нашёлся
// в JS-чанке фронтенда (156.156.*.js, строка "/node/searchEngine/v2/") — приватный
// AJAX-эндпоинт самого сайта, которым Vue-компонент фильтрует список у пользователя
// в браузере. Он принимает price_from/price_to корректно (проверено на контрольных
// диапазонах: 100-110к$ → 16 карточек, 1-2$ → 0, дефолт без цены → полный счётчик),
// но отдаёт только { count, items:[realty_id,...] } — без данных карточки.
//
// Полные данные (координаты, площадь, комнаты, фото, текст) берём с карточки
// объявления: https://dom.ria.com/uk/realty-<id>.html — префикс перед ID в пути
// сайт игнорирует и всё равно 301-редиректит на канонический SEO-адрес, поэтому
// точный слаг подбирать не нужно, короткий URL с одним ID работает как есть.
// Цена берётся из realty.priceArr[1] (это всегда доллары, независимо от валюты,
// в которой продавец включил объявление, — currency_type может быть "$"/"€"/"грн",
// priceArr[1] везде $), а не из realty.price (тот в валюте продавца).
//
// Объём в бюджете $30-45к оказался неожиданно большим (дома 345, квартиры 3635 на
// 9 городов) — контрольная выборка 24 карточек по Хмельницкому показала, что почти
// все это однокомнатные студии до 50 м², которые собственный фильтр каталога (area>=50,
// rooms>=2) всё равно отбросит: годных в выборке было 1 из 24 (~4%). Поэтому карточки
// всё равно нужно выкачивать поштучно — server-side фильтра по площади/комнатам
// у searchEngine v2 нет (проверялись area_min/rooms_from/s_area[from] — ни один параметр
// на счётчик не повлиял), но большая часть уйдёт в отсев уже на этом фильтре, и в
// data/domria9-candidates.json попадёт только то, что реально может пройти дальше.
//
// → data/domria9-candidates.json (формат loadExt() в units9.js).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [city-slug на dom.ria, украинское название, зона — как в OBL_ZONE units9.js, city_id, state_id]
const CITY = {
  vol: ['lutsk', 'Луцьк', 'Волынь', 18, 18],
  rov: ['rovno', 'Рівне', 'Ровенщина', 9, 9],
  lv: ['lvov', 'Львів', 'Львовщина', 5, 5],
  ter: ['ternopol', 'Тернопіль', 'Тернопольщина', 3, 3],
  if: ['ivano-frankovsk', 'Івано-Франківськ', 'Прикарпатье', 15, 15],
  chv: ['chernovtsy', 'Чернівці', 'Буковина', 25, 25],
  khm: ['khmelnytskyi', 'Хмельницький', 'Хмельниччина', 4, 4],
  zht: ['zhitomir', 'Житомир', 'Житомирщина', 2, 2],
  vin: ['vinnitsa', 'Вінниця', 'Винничина', 1, 1],
};
// [category, realty_type] — коды подтверждены на живых запросах (category=4/realty_type=0
// у SSR-страницы /prodazha-domov/ и category=1/realty_type=2 у /prodazha-kvartir/)
const TYPES = { house: [4, 0], flat: [1, 2] };
const LIMIT = 100;

async function fetchJson(url, referer) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'uk', 'x-requested-with': 'XMLHttpRequest', referer } });
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (t + 1)); }
  }
  return null;
}
async function fetchHtml(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'uk' } });
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch { await sleep(2000 * (t + 1)); }
  }
  return null;
}
function parseState(html) {
  const i = html.indexOf('window.__INITIAL_STATE__=');
  if (i < 0) return null;
  const start = i + 'window.__INITIAL_STATE__='.length;
  const end = html.indexOf('</script>', start);
  let s = html.slice(start, end).trim().replace(/;\(function\(\)[\s\S]*$/, '');
  if (s.endsWith(';')) s = s.slice(0, -1);
  try { return JSON.parse(s); } catch { return null; }
}
function photoUrl(file) {
  if (!file) return null;
  return 'https://cdn.riastatic.com/photos/' + file.replace(/\.\w+$/, '') + 'xl.webp';
}

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = {};
  const stats = { idPages: 0, ids: 0, fetched: 0, kept: 0, byObl: {} };
  for (const [obl, [slug, cityUa, zone, cityId, stateId]] of Object.entries(CITY)) {
    for (const [kind, [category, realtyType]] of Object.entries(TYPES)) {
      const catPath = kind === 'house' ? 'prodazha-domov' : 'prodazha-kvartir';
      const referer = `https://dom.ria.com/uk/${catPath}/${slug}/`;
      const ids = [];
      for (let page = 0; ; page++) {
        const q = `category=${category}&realty_type=${realtyType}&operation=1&state_id=${stateId}&city_id=${cityId}` +
          `&wo_dupl=1&price_from=${L.BUDGET_LO}&price_to=${L.BUDGET_HI}&page=${page}&limit=${LIMIT}`;
        const j = await fetchJson(`https://dom.ria.com/node/searchEngine/v2/?${q}`, referer);
        stats.idPages++;
        await sleep(900 + Math.random() * 500);
        if (!j || !Array.isArray(j.items) || !j.items.length) break;
        ids.push(...j.items);
        if (j.items.length < LIMIT || ids.length >= j.count) break;
      }
      stats.ids += ids.length;
      console.log(obl, kind, '— в бюджете (ID):', ids.length);
      for (const id of ids) {
        const html = await fetchHtml(`https://dom.ria.com/uk/realty-${id}.html`);
        stats.fetched++;
        await sleep(1100 + Math.random() * 600);
        if (!html) continue;
        const st = parseState(html);
        const r = st && st.listing && st.listing.data && st.listing.data.realty;
        if (!r) continue;
        const usd = r.priceArr && r.priceArr['1'] ? +String(r.priceArr['1']).replace(/\s/g, '') : null;
        if (!L.inBudget(usd)) continue;
        const area = r.total_square_meters || null;
        const rooms = r.rooms_count || null;
        if (kind === 'house' && (area || 0) < 65) continue;
        if (kind === 'flat' && ((area || 0) < 50 || (rooms != null && rooms < 2))) continue;
        const desc = r.description_uk || '';
        const streetAddr = [r.street_name_uk, r.building_number_str].filter(Boolean).join(' ');
        const title = streetAddr || r.district_name_uk || cityUa;
        const txt = title + ' ' + desc;
        if (L.SHARE.test(txt)) continue;
        if (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt)) continue;
        const photos = (r.photos || []).map(p => photoUrl(p.file)).filter(Boolean);
        store['DOMRIA' + id] = {
          id: 'DOMRIA' + id, kind, title, url: `https://dom.ria.com/uk/realty-${id}.html`,
          price: usd, area, land: r.ares_count || null, rooms,
          floor: r.floor || null, floors: r.floors_count || null,
          loc: r.district_name_uk || cityUa, zone,
          lat: r.latitude || null, lon: r.longitude || null, locExact: true,
          date: r.publishing_date ? String(r.publishing_date).slice(0, 10) : null,
          photoList: photos, text: desc,
        };
        stats.kept++;
        stats.byObl[obl] = (stats.byObl[obl] || 0) + 1;
      }
    }
  }
  fs.writeFileSync(D + 'domria9-candidates.json', JSON.stringify(Object.values(store)));
  console.log('domria9: запросов ID-списка', stats.idPages, '| ID в бюджете всего', stats.ids,
    '| карточек открыто', stats.fetched, '| прошли фильтры', stats.kept);
  console.log('по областям:', stats.byObl);
})();
