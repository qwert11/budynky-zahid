// flatfy.ua — витрина группы LUN (тот же CDN market-images.lunstatic.net, что у lun.ua),
// но это МЕТАПОИСК по чужим сайтам, а не собственная база объявлений: поле site.name
// в каждой карточке прямо называет источник. Контрольная выборка (386 карточек — все
// 9 городов, страница 1, дома и квартиры) показала: rieltor.ua 272 (70%), olx.ua 100
// (26%), lun.ua 8 (2%), dom.ria.com 6 (2%) — то есть 100% выборки уже приходит из
// источников, которые в каталоге и так есть отдельно (`riel`, `olx`, `lun`, а теперь
// и `domria`, см. scripts/domria9.js). Своих независимых карточек не нашлось совсем.
// Покупатель попросил добавить всё равно (2026-09-08) — источник заведён по общей схеме,
// но каждая карточка помечается полем site.name, и зеркала известных источников
// (SKIP_SITES ниже) выбрасываются, как раньше зеркала OLX у Metrazh (см. metrazh9.js):
// это тот же лот, что уже есть в другом источнике, а не новая площадь рынка.
//
// API: GET https://flatfy.ua/api/realties?section_id=<1|3>&geo_id=<город>&price_min=
// &price_max=&currency=USD&page=<N> → { data:[...], total_objects_count }. Найден в
// бандле static.lunstatic.net/static/js/main.*.js по строке "/api/select_realties/…"
// рядом (сам этот путь — для виджета рекомендаций, не для списка; список — /api/realties,
// подобран эмпирически и проверен: тот же порядок карточек, что и на SSR-странице).
// Цена уже в долларах, если currency=USD передан в запросе (currency в ответе — тоже
// USD у каждой карточки, конвертация на стороне API). section_id=1 — продаж квартир,
// section_id=3 — продаж будинків (проверено по счётчику на живых запросах).
// → data/flatfy9-candidates.json (формат loadExt() в units9.js).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [geo_id на flatfy.ua, украинское название, зона — как в OBL_ZONE units9.js]
const CITY = {
  vol: [10012656, 'Луцьк', 'Волынь'],
  rov: [10019894, 'Рівне', 'Ровенщина'],
  lv: [10012684, 'Львів', 'Львовщина'],
  ter: [10023304, 'Тернопіль', 'Тернопольщина'],
  if: [10008717, 'Івано-Франківськ', 'Прикарпатье'],
  chv: [10025207, 'Чернівці', 'Буковина'],
  khm: [10024474, 'Хмельницький', 'Хмельниччина'],
  zht: [10007252, 'Житомир', 'Житомирщина'],
  vin: [10003908, 'Вінниця', 'Винничина'],
};
const TYPES = { house: 3, flat: 1 }; // section_id
// источники, уже присутствующие в каталоге под своим именем — карточки-зеркала с этих
// сайтов не дают новой площади рынка (см. шапку файла)
const SKIP_SITES = new Set(['rieltor.ua', 'olx.ua', 'lun.ua', 'dom.ria.com', 'metrazh.com.ua']);

async function fetchJson(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept': 'application/json', 'accept-language': 'uk' } });
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (t + 1)); }
  }
  return null;
}
function photoUrl(imageId) {
  if (!imageId) return null;
  return `https://market-images.lunstatic.net/lun-ua/720/720/images/${imageId}.jpg`;
}

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = {};
  const stats = { pages: 0, raw: 0, mirrors: {}, kept: 0, byObl: {} };
  for (const [obl, [geoId, cityUa, zone]] of Object.entries(CITY)) {
    for (const [kind, sectionId] of Object.entries(TYPES)) {
      let page = 1, total = Infinity, seen = 0;
      for (; seen < total; page++) {
        const q = `section_id=${sectionId}&geo_id=${geoId}&price_min=${L.BUDGET_LO}&price_max=${L.BUDGET_HI}&currency=USD&page=${page}`;
        const j = await fetchJson(`https://flatfy.ua/api/realties?${q}`);
        stats.pages++;
        await sleep(700 + Math.random() * 500);
        if (!j || !Array.isArray(j.data)) break;
        total = j.total_objects_count || 0;
        if (!j.data.length) break;
        seen += j.data.length;
        stats.raw += j.data.length;
        for (const it of j.data) {
          const site = (it.site && (it.site.internal_name || it.site.name) || '').toLowerCase();
          if (SKIP_SITES.has(site)) { stats.mirrors[site] = (stats.mirrors[site] || 0) + 1; continue; }
          const price = it.price;
          if (!L.inBudget(price)) continue;
          const area = it.area_total || null;
          const rooms = it.room_count || null;
          if (kind === 'house' && (area || 0) < 65) continue;
          if (kind === 'flat' && ((area || 0) < 50 || (rooms != null && rooms < 2))) continue;
          const districtUa = (it.geo_entities || []).find(g => g.type === 'microdistrict' || g.type === 'district')?.name;
          const title = it.header || districtUa || cityUa;
          const desc = it.text || '';
          const txt = title + ' ' + desc;
          if (L.SHARE.test(txt)) continue;
          if (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt)) continue;
          const [lon, lat] = it.location || [null, null];
          const photos = (it.images || []).map(im => photoUrl(im.image_id)).filter(Boolean);
          store['FLATFY' + it.id] = {
            id: 'FLATFY' + it.id, kind, title, url: it.url_raw,
            price, area, land: null, rooms,
            floor: it.floor || null, floors: it.floor_count || null,
            loc: districtUa || cityUa, zone,
            lat, lon, locExact: true,
            date: it.insert_time ? String(it.insert_time).slice(0, 10) : null,
            photoList: photos, text: desc,
          };
          stats.kept++;
          stats.byObl[obl] = (stats.byObl[obl] || 0) + 1;
        }
        if (j.data.length < 24) break; // последняя страница отдала неполный набор
      }
      console.log(obl, kind, '— всего в бюджете (сайт):', total, '| страниц пройдено', page - 1);
    }
  }
  fs.writeFileSync(D + 'flatfy9-candidates.json', JSON.stringify(Object.values(store)));
  console.log('flatfy9: страниц', stats.pages, '| карточек всего', stats.raw, '| зеркала по сайтам', stats.mirrors,
    '| независимых и по правилам', stats.kept);
  console.log('по областям:', stats.byObl);
})();
