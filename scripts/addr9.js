// Точка на карте по адресу из объявления, а не по центру села.
// Из заголовка и описания достаём улицу (+номер дома) и название населённого пункта,
// геокодируем через Nominatim и принимаем результат, только если он рядом с базовой
// точкой лота (иначе это чужой одноимённый адрес). → data/addr9.json {id: {lat, lon, ...}}
const fs = require('fs');
const path = require('path');
const { addrHint } = require('./lib-addr9');
const D = path.join(__dirname, 'data') + path.sep;
const OUT = D + 'addr9.json';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { units, semi } = rd(D + 'units9.json');
const geo9 = rd(D + 'geocode9.json');
const cache = fs.existsSync(OUT) ? rd(OUT) : {};
const ALL = [...units, ...semi];

const KM = (a, b, c, d) => Math.hypot((a - c) * 111.32, (b - d) * 111.32 * Math.cos((a + c) / 2 * Math.PI / 180));
// радиус доверия: адрес должен быть рядом с базовой точкой населённого пункта
const R_STREET = 12, R_PLACE = 60;

// падежные формы названия улицы: «Спортивній» → «Спортивна», «Зарічного» → «Зарічний»
function streetForms(s) {
  const v = new Set([s]);
  const rules = [[/ій$/, 'а'], [/ій$/, 'ий'], [/ої$/, 'а'], [/ому$/, 'ий'], [/ого$/, 'ий'],
  [/ій$/, 'е'], [/ах$/, 'и'], [/у$/, 'а'], [/ю$/, 'я'], [/і$/, 'а']];
  for (const [re, to] of rules) if (re.test(s)) v.add(s.replace(re, to));
  return [...v];
}
// Nominatim в structured-режиме подсовывает соседнюю улицу, если точной не нашёл,
// поэтому имя в ответе обязательно сверяем с тем, что искали.
const normSt = s => (s || '').toLowerCase()
  .replace(/[ʼ'’`]/g, '').replace(/^(вулиця|вул\.?|провулок|пров\.?|проспект|просп\.?|бульвар|набережна)\s+/, '')
  .replace(/\s+(вулиця|провулок|проспект|бульвар)$/, '')
  .replace(/[іїы]/g, 'и').replace(/є/g, 'е').replace(/ґ/g, 'г')   // OSM пишет то «Коніщука», то «Конищука»
  .replace(/[^а-яa-z0-9\- ]/g, '').trim();
const stemSt = s => normSt(s).split(' ').map(w => w.length > 4 ? w.slice(0, -2) : w).join(' ');
function streetMatches(hit, form) {
  const road = (hit.address && (hit.address.road || hit.address.pedestrian || hit.address.residential)) || '';
  const first = (hit.display_name || '').split(',')[0];
  const want = stemSt(form);
  if (!want) return false;
  return [road, first, hit.name || ''].some(x => x && stemSt(x).includes(want));
}

const UA = 'budynky-zahid/1.0 (personal catalog build)';
async function nominatim(params) {
  const q = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', countrycodes: 'ua', 'accept-language': 'uk', ...params });
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + q, { headers: { 'User-Agent': UA } });
      if (r.status === 429 || r.status === 503) { await sleep(3000 * (t + 1)); continue; }
      if (!r.ok) return [];
      return await r.json();
    } catch { await sleep(1500 * (t + 1)); }
  }
  return [];
}

function baseOf(u) {
  const g = geo9[(u.loc || '') + '|' + (u.region || '')];
  if (g && g.lat) return { lat: g.lat, lon: g.lon };
  if (u.lat && u.lon) return { lat: u.lat, lon: u.lon };
  return null;
}

(async () => {
  const jobs = [];
  for (const u of ALL) {
    if (cache[u.id] !== undefined) continue;
    const h = addrHint(u);
    if (!h.street && !h.place) continue;
    const base = baseOf(u);
    if (!base) continue;
    jobs.push({ u, h, base });
  }
  console.log('лотов к геокодированию:', jobs.length, '| уже в кэше:', Object.keys(cache).length);
  let n = 0, okStreet = 0, okPlace = 0, skip = 0;
  for (const { u, h, base } of jobs) {
    const region = u.region || '';
    let city = u.loc || '';
    let result = null;

    // 1) населённый пункт из текста, если он не совпадает с полем объявления
    if (h.place && u.loc && h.place.toLowerCase().slice(0, 4) !== u.loc.toLowerCase().slice(0, 4)) {
      const hits = await nominatim({ city: h.place, state: region, country: 'Україна' });
      await sleep(1100);
      const hit = (hits || []).find(x => /village|town|city|hamlet|municipality|administrative|suburb/.test(x.type || x.addresstype || ''));
      if (hit && KM(+hit.lat, +hit.lon, base.lat, base.lon) <= R_PLACE) {
        result = { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), src: 'place', place: h.place, from: u.loc };
        city = h.place;
        okPlace++;
      }
    }
    // 2) улица внутри населённого пункта — самая точная метка
    if (h.street) {
      const anchor = result || base;
      // сначала улица без номера дома (с номером Nominatim чаще не находит ничего),
      // затем — уточнение номером, если сама улица нашлась
      const tries = [];
      for (const form of streetForms(h.street)) {
        tries.push({ form, street: form });
        if (h.house) tries.push({ form, street: h.house + ' ' + form });
      }
      // свободный запрос — последняя попытка: structured-режим строже к написанию
      tries.push({ form: h.street, free: 'вул. ' + h.street + (h.house ? ' ' + h.house : '') + ', ' + city + ', ' + region });
      let found = false;
      for (const t of tries) {
        const withHouse = !t.free && t.street !== t.form;
        if (found && !withHouse) break;   // улица уже найдена, другие падежные формы не нужны
        const hits = await nominatim(t.free ? { q: t.free } : { street: t.street, city, state: region, country: 'Україна' });
        await sleep(1100);
        const hit = (hits || []).find(x => streetMatches(x, t.form) && KM(+x.lat, +x.lon, anchor.lat, anchor.lon) <= R_STREET);
        if (!hit) continue;
        result = {
          lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), src: 'street',
          street: t.form, house: withHouse ? h.house : null, place: city,
          osm: hit.osm_type + '/' + hit.osm_id, kind: hit.type || hit.addresstype || null,
        };
        if (!found) okStreet++;
        found = true;
        if (withHouse) break;             // адрес с домом — точнее некуда
      }
    }
    cache[u.id] = result || null;
    if (!result) skip++;
    n++;
    if (n % 20 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(cache));
      console.log(' ', n, '/', jobs.length, '| по улице', okStreet, '| по н.п.', okPlace, '| без результата', skip);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log('готово:', n, 'обработано | по улице', okStreet, '| по н.п.', okPlace, '| без результата', skip);
})();
