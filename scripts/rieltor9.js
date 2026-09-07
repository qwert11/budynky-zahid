// Rieltor.ua — источник на платформе LUN Group (общий CDN market-images.lunstatic.net
// и общие -lun- CSS-классы с lun.ua, но своя база лотов и свой URL-роутинг: не дубли,
// а отдельный набор объявлений). Фильтр цены живёт только в гривне (price_min/price_max),
// параметр currency/cash_type в URL не действует — поэтому берём широкую полосу в грн
// с запасом и режем строго по факту выведенной в карточке цене в $ (data-label).
// Карточка поиска уже содержит всё нужное: id, координаты (data-longitude/latitude —
// точка, которую сам продавец поставил на карте, а не зашумлённый пин OLX), адрес,
// площадь/комнаты/этаж/сотки, короткое описание — отдельный запрос на объявление не нужен.
// → data/rieltor9-candidates.json (формат loadExt() в units9.js).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [city-slug, украинское название по умолчанию, зона — как в OBL_ZONE units9.js]
const CITY = {
  vol: ['lutsk', 'Луцьк', 'Волынь'], rov: ['rovno', 'Рівне', 'Ровенщина'], lv: ['lvov', 'Львів', 'Львовщина'],
  ter: ['ternopol', 'Тернопіль', 'Тернопольщина'], if: ['ivano-frankovsk', 'Івано-Франківськ', 'Прикарпатье'],
  chv: ['chernovtsy', 'Чернівці', 'Буковина'], khm: ['hmelnitskij', 'Хмельницький', 'Хмельниччина'],
  zht: ['zhitomir', 'Житомир', 'Житомирщина'], vin: ['vinnitsa', 'Вінниця', 'Винничина'],
};
const TYPES = { 'flats-sale': 'flat', 'houses-sale': 'house' };
// широкая полоса в грн с запасом вокруг $30-45k (курс плавает, точный отсекаем по $ из карточки)
const PMIN = 900000, PMAX = 2300000;
const MAXPAGE = 25;

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

function parseCards(html) {
  const iMain = html.indexOf('data-listing-items');
  const iAdd = html.indexOf('data-listing-add-items-part');
  if (iMain < 0) return [];
  const seg = html.slice(iMain, iAdd > iMain ? iAdd : html.length);
  const cardRe = /<div class="catalog-card [^"]*"\s+data-label="([^"]*)"[^>]*data-jss="catalog-item"\s+data-catalog-item-id="(\d+)"\s+data-longitude="([^"]*)"\s+data-latitude="([^"]*)">/g;
  const starts = [];
  let m;
  while ((m = cardRe.exec(seg))) starts.push({ idx: m.index, label: m[1], id: m[2], lon: +m[3], lat: +m[4] });
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], end = i + 1 < starts.length ? starts[i + 1].idx : seg.length;
    const chunk = seg.slice(s.idx, end);
    const priceM = /^([\d\s]+)\s*\$/.exec(s.label.trim());
    if (!priceM || !(s.lat && s.lon)) continue; // цена не в $ или нет координат — не сравнить/не привязать надёжно
    const price = +priceM[1].replace(/\s/g, '');
    const link = (chunk.match(/href="(https:\/\/rieltor\.ua\/[a-z0-9-]+\/(?:flats|houses)-sale\/view\/\d+\/)"/) || [])[1] || null;
    const address = ((chunk.match(/catalog-card-address">([^<]*)</) || [])[1] || '').trim();
    const region = [...chunk.matchAll(/card-click-region"[^>]*>\s*([^<]+?)\s*</g)].map(x => x[1].trim());
    const roomsM = /(\d+)\s*кімнат/.exec(chunk);
    const area3 = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*м²/.exec(chunk);
    const area1 = area3 || /(\d+(?:[.,]\d+)?)\s*м²/.exec(chunk);
    const floorM = /поверх\s*(\d+)\s*з\s*(\d+)/.exec(chunk);
    const floorsOnly = /(\d+)\s*поверх(?:и|ів)?\s*<\/span>/.exec(chunk);
    // \b не работает после кириллицы (границей слова JS считает только латиницу/цифры) —
    // граница задаётся лукахедом, а не \b
    const landM = /(\d+(?:[.,]\d+)?)\s*сот(?![а-яіїєґА-ЯІЇЄҐ])/.exec(chunk);
    const descM = /catalog-card-description"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(chunk);
    // "offer-photo-slider-slide-image" — фото самого объекта; на аватар риелтора
    // (класс "…-avatar", папка /avatars/ в URL) не претендуем
    const photoM = /class="offer-photo-slider-slide-image[^"]*"\s+src="([^"]+)"/.exec(chunk);
    out.push({
      id: 'RIEL' + s.id, price, lat: s.lat, lon: s.lon, link,
      address, region,
      rooms: roomsM ? +roomsM[1] : null,
      area: area1 ? +String(area1[1]).replace(',', '.') : null,
      floor: floorM ? +floorM[1] : null,
      floors: floorM ? +floorM[2] : (floorsOnly ? +floorsOnly[1] : null),
      land: landM ? +String(landM[1]).replace(',', '.') : null,
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
  for (const [obl, [slug, cityUa, zone]] of Object.entries(CITY)) {
    for (const [typePath, kind] of Object.entries(TYPES)) {
      let list = [];
      for (let page = 1; page <= MAXPAGE; page++) {
        const url = `https://rieltor.ua/${slug}/${typePath}/?page=${page}&price_min=${PMIN}&price_max=${PMAX}`;
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
        const title = c.address || cityUa;
        const desc = c.desc || '';
        const txt = title + ' ' + desc;
        if (kind === 'house' && (c.area || 0) < 65) continue;
        if (kind === 'flat' && ((c.area || 0) < 50 || (c.rooms != null && c.rooms < 2))) continue;
        if (L.SHARE.test(txt)) continue;
        if (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt)) continue;
        store[c.id] = {
          id: c.id, kind, title, url: c.link, price: c.price,
          area: c.area, land: c.land, rooms: c.rooms, floor: c.floor, floors: c.floors,
          loc: c.region[0] || cityUa, zone,
          lat: c.lat, lon: c.lon, locExact: true,
          date: null, photoList: c.photo ? [c.photo] : [], text: desc,
        };
        stats.kept++;
        stats.byObl[obl] = (stats.byObl[obl] || 0) + 1;
      }
    }
  }
  fs.writeFileSync(D + 'rieltor9-candidates.json', JSON.stringify(Object.values(store)));
  console.log('rieltor9: страниц', stats.pages, '| карточек всего', stats.raw, '| в бюджете и по правилам', stats.kept);
  console.log('по областям:', stats.byObl);
})();
