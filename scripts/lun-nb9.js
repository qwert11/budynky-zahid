// Новострой «под чистовую» напрямую от застройщика (просьба покупателя 07.09.2026:
// «добавь ещё варианты — чистовые квартиры от проверенного застройщика»).
//
// Отличие от всех прочих источников: это не объявление о конкретной квартире, а
// прайс девелопера по типу «N-кімнатні, площа от-до, від X млн грн» — сам застройщик
// не публикует поштучные квартиры с фото, только диапазон. Берём ровно то число,
// что показывает сам сайт («від …») как цену самого дешёвого юнита этого типа —
// это не наша оценка, а факт с прайса застройщика.
//
// «Проверенный» — не бейдж (у LUN/rieltor.ua такого нет, см. README), а эвристика
// по собственному профилю застройщика на LUN (lun.ua/uk/{забудовник}): год основания
// и число зданных/строящихся домов — это открытый послужной список, а не рекламный
// текст. Порог и сам список — на подтверждение покупателю перед тем как войдёт в сайт.
//
// Источник данных — каталог lun.ua/uk/новобудови-{місто} (НЕ rieltor.ua: там в разделе
// «Новобудови» нет ни профиля застройщика, ни истории сдачи, только рекламный текст).
// → data/lun-nb9-developers.json (для проверки), data/lun-nb9-candidates.json (формат loadExt()).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// [слаг каталога города на LUN, укр. название, зона — как в OBL_ZONE units9.js, центр города lat/lon]
const CITY = {
  vol: ['новобудови-луцька', 'Луцьк', 'Волынь', 50.7472, 25.3254],
  rov: ['новобудови-рівного', 'Рівне', 'Ровенщина', 50.6199, 26.2516],
  lv: ['новобудови-львова', 'Львів', 'Львовщина', 49.8397, 24.0297],
  ter: ['новобудови-тернополя', 'Тернопіль', 'Тернопольщина', 49.5535, 25.5948],
  if: ['новобудови-івано-франківська', 'Івано-Франківськ', 'Прикарпатье', 48.9226, 24.7111],
  chv: ['новобудови-чернівців', 'Чернівці', 'Буковина', 48.2915, 25.9403],
  khm: ['новобудови-хмельницького', 'Хмельницький', 'Хмельниччина', 49.4229, 26.9871],
  zht: ['новобудови-житомира', 'Житомир', 'Житомирщина', 50.2547, 28.6587],
  vin: ['новобудови-вінниці', 'Вінниця', 'Винничина', 49.2331, 28.4682],
};

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

function complexLinks(html) {
  return [...new Set([...html.matchAll(/href="(https:\/\/lun\.ua\/new\/[a-z]+\/[a-z0-9-]+)"/g)].map(m => m[1]))];
}

const num = s => { const n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };

function parsePriceRows(html) {
  const marker = /class="PriceRow-module-scss-module__[a-zA-Z0-9]+__root"/g;
  const starts = [...html.matchAll(marker)].map(m => m.index);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i], Math.min(starts[i] + 900, starts[i + 1] || html.length));
    const mains = [...chunk.matchAll(/mainText[^"]*">([^<]+)</g)].map(m => m[1]);
    const adds = [...chunk.matchAll(/additionalText[^"]*">([^<]+)</g)].map(m => m[1]);
    if (!mains[0] || !adds[0] || !adds[1] || !mains[1]) continue;
    const roomsM = /^(\d+)-кімнатн/.exec(mains[0]);
    const areaM = /([\d.,]+)(?:\s*—\s*([\d.,]+))?\s*м²/.exec(adds[0]);
    const ppmM = /([\d\s]+?)(?:\s*—\s*([\d\s]+))?\s*грн/.exec(adds[1]);
    const priceM = /від\s*([\d.,]+)\s*(млн|тис)?\s*грн/i.exec(mains[1]);
    if (!areaM || !ppmM || !priceM) continue;
    const mul = priceM[2] === 'тис' ? 1e3 : 1e6;
    out.push({
      rooms: roomsM ? +roomsM[1] : null,
      areaFrom: num(areaM[1]), areaTo: num(areaM[2]) || num(areaM[1]),
      ppmFrom: num(ppmM[1]),
      priceUahFrom: Math.round(num(priceM[1]) * mul),
    });
  }
  return out;
}

function complexInfo(html) {
  const devM = /href="(\/uk\/[^"]+)">Новобудови від забудовника\s+([^<]+)</.exec(html);
  const fxM = /курс перерахування\s*([\d]+[.,]\d+)/.exec(html);
  const titleM = /<meta property="og:title" content="([^"]+)"/.exec(html) || /<title>([^<|]+)/.exec(html);
  // og:image общий для всего сайта (лого) — фото самого ЖК берём из preload шапки
  const imgM = /imageSrcSet="(https:\/\/lun-images\.lunstatic\.net\/[^"]+?\.jpg)/.exec(html);
  const geoM = /"geo":\{"@type":"GeoCoordinates","latitude":([\d.]+),"@context":"[^"]+","longitude":([\d.]+)\}/.exec(html);
  const addrM = /"streetAddress":"([^"]+)"/.exec(html);
  const termM = /Термін введення[\s\S]{0,300}?PriceQueueSelect[^"]*__value">([^<]+)</.exec(html);
  return {
    devHref: devM ? 'https://lun.ua' + devM[1] : null, devName: devM ? devM[2].trim() : null,
    fx: fxM ? +fxM[1].replace(',', '.') : null,
    title: titleM ? titleM[1].trim() : null,
    photo: imgM ? imgM[1] : null,
    lat: geoM ? +geoM[1] : null, lon: geoM ? +geoM[2] : null,
    addr: addrM ? addrM[1] : null,
    term: termM ? termM[1].trim() : null,
    rows: parsePriceRows(html),
  };
}

function developerInfo(html) {
  const pairs = [...html.matchAll(/<b>([^<]{1,20})<\/b>\s*<div class="placeholder">([^<]{1,40})<\/div>/g)];
  let founded = null, delivered = 0, deliveredSince = null, inProgress = 0;
  for (const [, val, label] of pairs) {
    if (/рік заснування/.test(label)) founded = +val;
    else if (/здано/.test(label)) {
      delivered = +(/^\d+/.exec(val) || [0])[0];
      deliveredSince = +((/з (\d{4})/.exec(label) || [])[1]) || null;
    } else if (/в процесі/.test(label)) inProgress = +(/^\d+/.exec(val) || [0])[0];
  }
  return { founded, delivered, deliveredSince, inProgress };
}

// Эвристика доверия (на подтверждение покупателю, см. шапку файла): не моложе 5 лет
// на рынке И минимум 2 сданных дома — открытый послужной список, а не только обещания.
function isTrusted(dev) {
  if (!dev.founded || !dev.delivered) return false;
  return (new Date().getFullYear() - dev.founded) >= 5 && dev.delivered >= 2;
}

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const complexes = {}; // url -> {obl, zone, lat0, lon0}
  for (const [obl, [slug, cityUa, zone, lat0, lon0]] of Object.entries(CITY)) {
    const url = 'https://lun.ua/uk/' + encodeURIComponent(slug);
    const html = await fetchHtml(url);
    await sleep(1500 + Math.random() * 800);
    if (!html) { console.log(obl, 'каталог не открылся'); continue; }
    const links = complexLinks(html);
    console.log(obl, cityUa, '— ЖК на странице:', links.length);
    for (const l of links) if (!complexes[l]) complexes[l] = { obl, cityUa, zone, lat0, lon0 };
  }
  console.log('всего уникальных ЖК:', Object.keys(complexes).length);

  const developers = {}; // href -> {name, ...info, trusted}
  const rawComplexes = [];
  let n = 0;
  for (const [url, meta] of Object.entries(complexes)) {
    const html = await fetchHtml(url);
    n++;
    await sleep(1200 + Math.random() * 600);
    if (!html) continue;
    const info = complexInfo(html);
    if (!info.devHref || !info.rows.length) continue;
    if (!developers[info.devHref]) developers[info.devHref] = { name: info.devName, href: info.devHref, pending: true };
    rawComplexes.push({ url, ...meta, ...info });
    if (n % 20 === 0) console.log('  ЖК обработано', n, '/', Object.keys(complexes).length);
  }
  console.log('ЖК с прайсом и застройщиком:', rawComplexes.length, '| уникальных застройщиков:', Object.keys(developers).length);

  let dn = 0;
  for (const href of Object.keys(developers)) {
    const html = await fetchHtml(href);
    dn++;
    await sleep(1200 + Math.random() * 600);
    if (!html) { developers[href].error = true; continue; }
    Object.assign(developers[href], developerInfo(html));
    developers[href].trusted = isTrusted(developers[href]);
    delete developers[href].pending;
  }
  console.log('застройщиков проверено:', dn, '| доверенных:', Object.values(developers).filter(d => d.trusted).length);

  fs.writeFileSync(D + 'lun-nb9-developers.json', JSON.stringify(developers, null, 1));
  fs.writeFileSync(D + 'lun-nb9-raw.json', JSON.stringify(rawComplexes));
  console.log('сохранено: data/lun-nb9-developers.json (на проверку), data/lun-nb9-raw.json (сырьё)');

  // кандидаты: только доверенные застройщики, только типы с площадью и бюджетом «как у всех»
  // (area ≥50, ≤$45 тыс. от «від»-цены — это факт с прайса, не наша оценка)
  const cand = [];
  for (const c of rawComplexes) {
    const dev = developers[c.devHref];
    if (!dev || !dev.trusted || !c.fx) continue;
    for (const row of c.rows) {
      if (!row.rooms || row.rooms < 2 || (row.areaFrom || 0) < 50) continue;
      const price = Math.round(row.priceUahFrom / c.fx);
      if (!L.inBudget(price)) continue;
      const slug = (c.url.split('/').filter(Boolean).pop() || '').replace(/[^a-zA-Z0-9]/g, '');
      cand.push({
        id: 'LUNNB' + slug.slice(0, 28) + '_' + row.rooms,
        kind: 'flat', src: 'lunnb',
        title: `${c.title || c.cityUa}, ${row.rooms}-к від ${price.toLocaleString('uk')} $`,
        url: c.url, price, area: row.areaFrom, rooms: row.rooms,
        loc: c.cityUa, zone: c.zone,
        lat: c.lat ?? c.lat0, lon: c.lon ?? c.lon0, locExact: !!c.lat,
        developer: dev.name, addr: c.addr, term: c.term,
        photoList: c.photo ? [c.photo] : [],
        text: `Новобудова, чистова обробка. Забудовник «${dev.name}» — на ринку з ${dev.founded} р., здано ${dev.delivered} буд., у процесі ${dev.inProgress}. ${c.addr || ''} ${c.term ? 'Термін введення ' + c.term : ''}`,
      });
    }
  }
  fs.writeFileSync(D + 'lun-nb9-candidates.json', JSON.stringify(cand));
  console.log('кандидатов в бюджете от доверенных застройщиков:', cand.length);
  const byObl = {};
  for (const c of cand) byObl[c.zone] = (byObl[c.zone] || 0) + 1;
  console.log('по зонам:', JSON.stringify(byObl));
})();
