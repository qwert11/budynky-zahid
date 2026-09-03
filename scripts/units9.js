// Каталог v3: девять областей (Запад + Хмельницкая, Житомирская, Винницкая),
// формат «топ-50 на область» отдельно по домам и квартирам В КАЖДОМ источнике
// (OLX, ЛУН, Телеграм, Фейсбук). Правила покупателя от 02.09.2026:
//   • дальше 10 км от города — не рассматриваем вообще (кроме закреплённых
//     лотов с разбором «нам подходит» — их метки нельзя терять);
//   • близость к городу в индексе цена/качество весит 2:1 к каждой другой категории.
// Набор «получистовая» — отдельный список по тем же правилам (топ-50 на область в каждом
// источнике по домам и квартирам, ≤10 км): кандидаты — то, что готовый отбор отбросил по
// состоянию, плюс перенесённые карточки прежней страницы (live-semi.json).
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const SP9 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/09f7008e-ddb2-410c-96d4-ccf69000c0d4/scratchpad/';
const D5 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/';
const D2 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/2ba88487-cdb9-423e-b5e9-69abf018ad10/scratchpad/';
const EXT = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/7f7d4dba-ff73-4030-a5e2-5fb02c6c4786/scratchpad/';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// Латиница внутри украинских слов ломает UNFIN/BAD_TEXT/SHARE: «будiвельний вагончик»
// с латинской i проходил как готовое жильё. Чистим заголовок и описание на входе,
// один раз для всех источников (см. deLatin в lib9.js).
const deL = o => {
  if (o && typeof o === 'object') for (const k of ['title', 'desc', 'text'])
    if (typeof o[k] === 'string') o[k] = L.deLatin(o[k]);
  return o;
};
const rdLots = f => { const j = rd(f); if (Array.isArray(j)) j.forEach(deL); else if (j.items) Object.values(j.items).forEach(deL); return j; };
const ex = f => fs.existsSync(f);

const TOP = 50, KM_MAX = 10;
const DEAD = new Set(rd(path.join(__dirname, '..', 'dead.json')).dead || []);
const EXCLUDED = new Set(rd(path.join(__dirname, '..', 'excluded.json')).excluded || []);
const geo9 = rd(D + 'geocode9.json');
const shapes = rd(D + 'oblast-shapes9.json');
const vet = ex(D + 'photo-vet.json') ? rd(D + 'photo-vet.json') : {};
const views9 = ex(D + 'views9.json') ? rd(D + 'views9.json') : {};
const family = ex(D + 'family.json') ? rd(D + 'family.json') : (ex(D5 + 'family.json') ? rd(D5 + 'family.json') : {});
const PINNED = new Set(Object.keys(family));
const legacyVetted = new Set((ex(D2 + 'ranked.json') ? rd(D2 + 'ranked.json') : []).map(r => r.id));
const addr9 = ex(D + 'addr9.json') ? rd(D + 'addr9.json') : {};
const livePts = ex(D + 'live-pts.json') ? Object.fromEntries(rd(D + 'live-pts.json').map(p => [p.i, p])) : {};

const NOW = Date.now();
const daysSince = iso => iso ? Math.max(1, Math.round((NOW - Date.parse(iso)) / 86400000)) : null;
const usdOf = u => u.cur === 'USD' ? u.price : (u.curConv === 'USD' ? u.priceConv : null);
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };

const drop = { dead: 0, excluded: 0, share: 0, unfin: 0, far: 0, nogeo: 0, badtype: 0, budget: 0, small: 0, unvetted: 0, zak: 0,
  nbShell: 0, nbNoPhoto: 0, nbWait: 0 };
let pinnedKept = 0;

function coordsFor(u) {
  // адрес из текста объявления точнее центра населённого пункта
  const a = addr9[u.id];
  if (a && a.lat) return { lat: a.lat, lon: a.lon, src: a.src === 'street' ? (a.house ? 'house' : 'street') : 'place' };
  const k = (u.loc || '') + '|' + (u.region || '');
  const g = geo9[k];
  if (g && g.lat) return { lat: g.lat, lon: g.lon, src: 'loc' };
  if (u.lat && u.lon) return { lat: u.lat, lon: u.lon, src: 'olxmap' };
  const lp = livePts[u.id];
  if (lp) return { lat: lp.lat, lon: lp.lon, src: 'live' };
  return null;
}
// Новостройка в приоритете (просьба покупателя 03.09.2026): у OLX есть параметр
// «Новобудова», у ЛУНа и Телеграма — только текст, поэтому там смотрим заголовок с описанием.
// «ЖК» в шаблон не берём: он ловит «обмін на квартиру в ЖК» у обычной вторички.
const NEWBUILD = /новобудов|новобуд\.|нова забудова|щойно зданий будинок/i;
function markNew(u) {
  const txt = (u.title || '') + ' ' + String(u.desc || '').slice(0, 300);
  if (u.isNew == null) u.isNew = NEWBUILD.test(txt);
  // стройка — не новостройка: лот «на етапі взведення покрівлі» приоритета не получает,
  // иначе он встаёт первым в списке впереди готового жилья
  if (u.isNew && (L.UNFIN.test(txt) || L.BAD_TEXT.test(txt))) u.isNew = false;
  return u;
}

function finish(u) {
  // координаты → км до города → область → индекс
  const c = coordsFor(u);
  if (c) { u.lat = c.lat; u.lon = c.lon; u.geoSrc = c.src; }
  if (u.lat && u.lon) {
    const n = L.nearestCity(u.lat, u.lon);
    u.km = n.km; u.city = n.city;
    if (!u.obl) u.obl = L.oblastOf(u.lat, u.lon, shapes);
  }
  u.ppm = u.ppm || (u.price && u.area ? Math.round(u.price / u.area) : null);
  u.quality = u.kind === 'house' ? L.houseQuality9(u) : L.flatQuality9(u);
  markNew(u);
  return u;
}
// базовые ворота для всех источников
function gate(u) {
  if (DEAD.has(u.id)) { drop.dead++; return false; }
  if (EXCLUDED.has(u.id)) { drop.excluded++; return false; }
  if (u.obl === 'zak' || u.obl == null && u.region === 'Закарпатська область') { drop.zak++; return false; }
  if (PINNED.has(u.id)) { pinnedKept++; return true; }        // разобранное избранное держим всегда
  if (u.lat == null || u.km == null) { drop.nogeo++; return false; }
  if (u.km > KM_MAX) { drop.far++; return false; }
  return true;
}

/* ════════ 1. дома OLX (свежий сбор по 9 областям) ════════ */
const housesPool = Object.values(rdLots(D + 'olx9-houses.json').items).map(x => {
  const p = x.params || {};
  return {
    id: x.id, sku: x.sku, src: 'olx', kind: 'house', title: x.title, link: x.link,
    price: usdOf(x), cur: 'USD',
    area: num(p['total_area:key']), land: num(p['land_area:key']), rooms: num(p.number_of_rooms),
    floors: num(p['total_floors:key']),
    heating: p.heating || null, repair: p.repair || null, walls: p.house_type || null,
    comm: p.communications || null, bathroom: p.bathroom_3 || null, propType: p['property_type_houses:key'] || null,
    noCommission: /без комісії/i.test(p.commission || ''),
    loc: x.loc, cityId: x.cityId, region: x.region, obl: L.REGION2SLUG[x.region] || null,
    lat: x.lat, lon: x.lon, created: x.created, days: daysSince(x.created),
    photos: x.photos || [], photoUrl: (x.photos || [])[0] || null, desc: x.desc, business: x.business,
  };
});
const housesCand = [];
const housesOlx = [];
for (const u of housesPool) {
  if (!L.inBudget(u.price)) { drop.budget++; continue; }
  if ((u.area || 0) < 65) { drop.small++; continue; }
  if (['dacha', 'garden_house'].includes(u.propType || '')) { drop.badtype++; continue; }
  if (L.SHARE.test((u.title || '') + ' ' + String(u.desc || '').slice(0, 260))) { drop.share++; continue; }
  if (L.UNFIN.test(u.desc || '') || L.UNFIN.test(u.title || '')) { drop.unfin++; continue; }
  finish(u);
  if (!gate(u)) continue;
  const verdict = vet[u.id] || (legacyVetted.has(u.id) ? 'ok' : null);
  if (PINNED.has(u.id) || verdict === 'ok') housesOlx.push(u);
  else if (verdict !== 'no') housesCand.push(u); // ждёт фотопроверки
  else drop.unvetted++;
}

/* ════════ 2. квартиры OLX (свежий сбор) ════════ */
const ROOMS = { odnokomnatnye: 1, dvuhkomnatnye: 2, trehkomnatnye: 3, tryohkomnatnye: 3, chetyryohkomnatnye: 4, pyatikomnatnye: 5, shestikomnatnye: 6 };
const flatsOlx = [];
for (const x of Object.values(rdLots(D + 'olx9-flats.json').items)) {
  const p = x.params || {};
  const u = {
    id: x.id, sku: x.sku, src: 'olx', kind: 'flat', title: x.title, link: x.link,
    price: usdOf(x), cur: 'USD',
    area: num(p['total_area:key']), rooms: ROOMS[p['number_of_rooms_string:key']] || num(p.number_of_rooms_string) || null,
    floor: num(p['floor:key'] || p.floor), floors: num(p['total_floors:key'] || p.total_floors),
    repair: p.repair || null, market: p.apartments_object_type || null, houseType: p.property_type_appartments_sale || null,
    isNew: /новобудова/i.test(p.apartments_object_type || ''),
    walls: p.house_type || null, heating: p.heating || null, bathroom: p.bathroom || null, comm: p.communications || null,
    noCommission: /без комісії/i.test(p.commission || ''),
    loc: x.loc, cityId: x.cityId, region: x.region, obl: L.REGION2SLUG[x.region] || null,
    lat: x.lat, lon: x.lon, created: x.created, days: daysSince(x.created),
    photos: x.photos || [], photoUrl: (x.photos || [])[0] || null, desc: x.desc, business: x.business,
  };
  if (!L.inBudget(u.price)) { drop.budget++; continue; }
  if ((u.area || 0) < 50 || (u.rooms || 0) < 2) { drop.small++; continue; }
  // Новобудова больше не выбрасывается из «готового» (03.09.2026, просьба покупателя:
  // новостройка в приоритете). Раньше метка «Новобудова» отсекала квартиру независимо
  // от фактического состояния, и 143 лота проваливались мимо обоих наборов: в готовое
  // не пускала метка, в получистовую — отсутствие текстового признака недостроя.
  // Состояние решают те же правила, что и у всех: поле «Ремонт» и текст объявления.
  if (L.BAD_REPAIR.test(u.repair || '')) { drop.unfin++; continue; }
  if (L.BAD_TEXT.test((u.title || '') + ' ' + (u.desc || ''))) { drop.unfin++; continue; }
  if (L.SHARE.test((u.title || '') + ' ' + String(u.desc || '').slice(0, 260))) { drop.share++; continue; }
  finish(u);
  if (!gate(u)) continue;
  flatsOlx.push(u);
}

/* ════════ 3. ЛУН: старый сбор (запад) + новый (Хм/Жит/Вин, если есть) ════════ */
const GROUP2OBL = {
  'Львів': 'lv', 'Івано-Франківськ': 'if', 'Тернопіль': 'ter', 'Рівне': 'rov', 'Луцьк': 'vol',
  'Чернівці': 'chv', 'Ужгород': 'zak', 'Хмельницький': 'khm', 'Житомир': 'zht', 'Вінниця': 'vin',
};
const geoLun = ex(D5 + 'geocode-lun.json') ? rd(D5 + 'geocode-lun.json') : {};
const geoLun9 = ex(D + 'lun9-geocode.json') ? rd(D + 'lun9-geocode.json') : {};
const lunDet = ex(D5 + 'lun-details.json') ? rd(D5 + 'lun-details.json') : {};
const lunAll = [];
function shapeLun(x) {
  const g = geoLun[[x.loc || '', x.district || '', x.cityGroup || ''].join('|')] ||
    geoLun9[(x.loc || x.cityGroup) + '|' + x.cityGroup] || null;
  return {
    id: x.id, src: 'lun', srcSite: x.srcSite || null, kind: x.kind, title: x.title, link: x.link,
    price: x.price, area: x.area, land: x.landSot, rooms: x.rooms,
    ppm: x.ppm || null, loc: x.loc || (x.district || '').replace(/ район$/, ''), region: x.district,
    obl: GROUP2OBL[x.cityGroup] || null,
    lat: g ? +g.lat : null, lon: g ? +g.lon : null, created: null, days: null,
    repair: null, heating: null, photoUrl: (x.photos || [])[0] || null, photos: x.photos || [],
    noCommission: !!x.noCommission, desc: x.desc,
  };
}
const lunClean = [...(ex(D5 + 'lun-clean.json') ? rdLots(D5 + 'lun-clean.json') : []), ...(ex(D + 'lun9-clean.json') ? rdLots(D + 'lun9-clean.json') : [])];
for (const x of lunClean) {
  if (x.unfinished || !L.inBudget(x.price)) continue;
  const u = shapeLun(x);
  const d = lunDet[u.id] || (ex(D + 'lun9-details.json') ? (rd(D + 'lun9-details.json')[u.id] || null) : null);
  if (d && !d.error) {
    if (num(d.area)) u.area = num(d.area);
    if (num(d.rooms)) u.rooms = num(d.rooms);
    if (num(d.land)) u.land = num(d.land);
    if (num(d.floor)) u.floor = num(d.floor);
    if (num(d.floors)) u.floors = num(d.floors);
    if (d.walls) u.walls = d.walls;
    if (d.heating) u.heating = d.heating;
    if (d.locality && !u.loc) u.loc = d.locality;
    if ((d.photos || []).length) { u.photos = d.photos; u.photoUrl = d.photos[0]; }
    if (d.desc) u.desc = ((u.desc || '') + ' ' + d.desc).slice(0, 1200);
    u.gone = !!d.gone;
  }
  if (u.gone) continue;
  if (u.kind === 'house' && (u.area || 0) < 65) continue;
  if (u.kind === 'flat' && ((u.area || 0) < 50 || ((u.rooms || 0) < 2 && u.rooms != null))) continue;
  if (L.UNFIN.test(u.desc || '')) { drop.unfin++; continue; }
  if (L.SHARE.test((u.title || '') + ' ' + String(u.desc || '').slice(0, 260))) { drop.share++; continue; }
  finish(u);
  if (!gate(u)) continue;
  if (u.obl === 'zak') { drop.zak++; continue; }
  lunAll.push(u);
}

/* ════════ 4. Телеграм и Фейсбук ════════ */
const OBL_ZONE = {
  'Волынь': 'vol', 'Ровенщина': 'rov', 'Львовщина': 'lv', 'Тернопольщина': 'ter',
  'Прикарпатье': 'if', 'Буковина': 'chv', 'Хмельниччина': 'khm', 'Житомирщина': 'zht', 'Винничина': 'vin',
};
const ZONE_REGION = {
  vol: 'Волинська область', rov: 'Рівненська область', lv: 'Львівська область', ter: 'Тернопільська область',
  if: 'Івано-Франківська область', chv: 'Чернівецька область', khm: 'Хмельницька область', zht: 'Житомирська область', vin: 'Вінницька область',
};
function loadExt(file, src, geoFile, dir) {
  if (!ex(dir + file)) return [];
  const geo = geoFile && ex(dir + geoFile) ? rd(dir + geoFile) : {};
  return rdLots(dir + file).map(r => {
    const g = r.lat != null ? { lat: r.lat, lon: r.lon } : (geo[r.loc + '|' + r.zone] || null);
    const obl = OBL_ZONE[r.zone] || null;
    return {
      id: r.id, src, kind: r.kind, title: r.title, link: r.url,
      price: r.price, area: r.area || null, land: r.land || null, rooms: r.rooms || null,
      floor: r.floor || null, floors: r.floors || null,
      loc: r.loc, region: ZONE_REGION[obl] || r.zone, obl,
      lat: g ? +g.lat : null, lon: g ? +g.lon : null,
      created: r.date ? r.date + 'T12:00:00+03:00' : null, days: daysSince(r.date ? r.date + 'T12:00:00+03:00' : null),
      photoUrl: (r.photoList || [])[0] || null, photos: r.photoList || [],
      noCommission: false, desc: r.text || '', locExact: !!r.locExact, chan: r.ch || null,
    };
  }).filter(u => L.inBudget(u.price));
}
const tgAll = [...loadExt('tme-candidates.json', 'tg', 'tg-geocode.json', EXT), ...loadExt('tg9-candidates.json', 'tg', 'tg9-geocode.json', D)]
  .map(finish).filter(gate);
const fbAll = loadExt('fb-candidates.json', 'fb', null, EXT).map(finish).filter(gate);

/* ════════ 5. топ-50 на область в каждом наборе источник×тип (готовое) ════════ */
function dedupe(arr) {
  const seen = new Set(), out = [];
  for (const u of arr.sort((a, b) => b.quality - a.quality)) {
    const k = [u.kind, u.price, Math.round(u.area || 0), (u.loc || '').toLowerCase()].join('|');
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}
// раскладка по областям и обрезка до TOP; setKey — подпись набора, prefix — 'semi:' для получистовой
function pickTop(sets, out, stats, prefix) {
  for (const [key, arr] of Object.entries(sets)) {
    const byObl = {};
    for (const u of arr) {
      const o = u.obl || 'unk';
      (byObl[o] = byObl[o] || []).push(u);
    }
    const parts = [];
    for (const [o, list] of Object.entries(byObl)) {
      if (o === 'unk' || o === 'zak') continue;
      // новостройки идут первыми и внутри себя по индексу — они не должны вылетать
      // из топ-50 под давлением вторички (просьба покупателя 03.09.2026)
      list.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || b.quality - a.quality);
      list.slice(0, TOP).forEach((u, i) => { u.rankIn = i + 1; u.setKey = (prefix || '') + key; out.push(u); });
      parts.push(o + ':' + Math.min(list.length, TOP));
    }
    stats.push(((prefix || '') + key).padEnd(15) + ' ' + parts.sort().join(' '));
  }
}
/* ════════ 4b. новострой — только с живыми фото готового жилья ════════
   Правило покупателя 03.09.2026: «новострой чистовая — мы его игнорим, а новострой
   в приоритете — это самое лучшее». Раз новострой встаёт первым в каталоге, метка
   должна означать готовое жильё, а не коробку.

   Текстом это не отличить: у типовой новостройки «под чистову» поле «Ремонт» пустое,
   слов «без ремонту» в описании нет, а бывает и наоборот — «квартира вже на ключах».
   Единственный источник правды — фотографии, поэтому каждая новостройка проходит
   ту же фотопроверку, что и дома OLX, и попадает в готовое только с вердиктом ok.

   Вердикт ok — на фото жилой интерьер: пол, обои или краска, двери, кухня, мебель.
   Вердикт no — бетон, стяжка и штукатурка; только планировка; только рендер
   застройщика; только фасад или двор. Фото нет вовсе — тоже no: проверить нечем. */
const nbCand = [];        // ждут фотопроверки
const nbHold = new Set(); // id, не допущенных в каталог: и отклонённые, и ждущие
function nbPass(u) {
  if (!u.isNew) return true;
  if (PINNED.has(u.id)) return true;                       // разобранное избранное держим всегда
  const verdict = vet[u.id] || (legacyVetted.has(u.id) ? 'ok' : null);
  if (verdict === 'ok') return true;
  nbHold.add(u.id);
  if (verdict === 'no') { drop.nbShell++; return false; }  // на фото чистовая, план или рендер
  if (!(u.photos || []).length) { drop.nbNoPhoto++; return false; }
  nbCand.push(u); drop.nbWait++; return false;
}
const sets = {
  'olx|house': dedupe(housesOlx.filter(nbPass)), 'olx|flat': dedupe(flatsOlx.filter(nbPass)),
  'lun|house': dedupe(lunAll.filter(u => u.kind === 'house').filter(nbPass)), 'lun|flat': dedupe(lunAll.filter(u => u.kind === 'flat').filter(nbPass)),
  'tg|house': dedupe(tgAll.filter(u => u.kind === 'house').filter(nbPass)), 'tg|flat': dedupe(tgAll.filter(u => u.kind === 'flat').filter(nbPass)),
  'fb|house': dedupe(fbAll.filter(u => u.kind === 'house').filter(nbPass)), 'fb|flat': dedupe(fbAll.filter(u => u.kind === 'flat').filter(nbPass)),
};
const units = [];
const setStats = [];
pickTop(sets, units, setStats, '');
const readyIds = new Set(units.map(u => u.id));

/* ════════ 6. получистовая — отдельный набор по тем же правилам (просьба покупателя
   02.09.2026: не конкурирует с готовым за места, но строится по аналогии — топ-50 на
   область по домам и квартирам в каждом источнике, ≤10 км, близость к городу ×2).
   Кандидаты: то, что готовый отбор отбросил по состоянию (текст «недобудова / під
   чистову / потребує ремонту», параметр «Ремонт», фотопроверка «не жилой дом»),
   плюс перенесённые с прежней страницы карточки. ════════ */
const semiDrop = { noclass: 0, ready: 0, budget: 0, small: 0, badtype: 0, share: 0, gate: 0, vetOkReady: 0 };
const semiCand = [];
const seenSemi = new Set();
const liveById = {};
const semiLive = rdLots(D + 'live-semi.json');
for (const s of semiLive) liveById[s.id] = s;
// доля объекта — не берём; но «частина будинку придатна, інша — потребує» — это наш класс part
const shareSemi = u => L.SHARE.test((u.title || '') + ' ' + String(u.desc || '').slice(0, 100)) && !L.SEMI_TXT.part.test(u.desc || '');
// «Получистовая» — это жильё, в которое можно заселиться и доводить ремонт
// (правило покупателя 03.09.2026). Коробка под чистовую жильём не является:
// у класса shell в его же описании сказано «заехать сразу нельзя», поэтому
// такие лоты в набор не берём вовсе.
const SEMI_SKIP = new Set(['shell']);
function pushSemi(u, cls) {
  if (SEMI_SKIP.has(cls)) { semiDrop.notlivable = (semiDrop.notlivable || 0) + 1; return; }
  // новострой без фотопроверки не должен просочиться сюда через второй проход:
  // бейдж «НОВОСТРОЙ» и приоритет действуют в обоих списках
  if (nbHold.has(u.id)) { semiDrop.nbHold = (semiDrop.nbHold || 0) + 1; return; }
  // Бейдж «НОВОСТРОЙ» значит «проверенное готовое жильё, идёт первым». В получистовой
  // лот по определению недоделан, поэтому признак снимается: иначе первым в каталоге
  // встаёт новострой под чистову — ровно то, что покупатель просил игнорировать.
  u.isNew = false;
  if (seenSemi.has(u.id)) return;
  u.ready = 'semi'; u.semi = cls;
  u.quality = u.kind === 'house' ? L.semiHouseQuality9(u) : L.semiFlatQuality9(u);
  seenSemi.add(u.id); semiCand.push(u);
}
// 6a. дома и квартиры OLX из свежего сбора
for (const u of housesPool) {
  if (readyIds.has(u.id)) { semiDrop.ready++; continue; }
  if (!L.inBudget(u.price)) { semiDrop.budget++; continue; }
  if ((u.area || 0) < 65) { semiDrop.small++; continue; }
  if (['dacha', 'garden_house'].includes(u.propType || '')) { semiDrop.badtype++; continue; }
  if (shareSemi(u)) { semiDrop.share++; continue; }
  if (vet[u.id] === 'ok') { semiDrop.vetOkReady++; continue; }          // на фото жилой дом — это кандидат в готовое
  let cls = liveById[u.id] ? (liveById[u.id].attrs.semi || null) : null;  // класс с прежней страницы надёжнее регэкспа
  if (!cls) cls = L.semiClass(u);
  if (cls === 'repair' && vet[u.id] === 'no') cls = L.SEMI_TXT.util.test((u.title || '') + ' ' + (u.desc || '')) ? 'shell' : null;
  if (!cls) { semiDrop.noclass++; continue; }
  if (u.km == null) finish(u);
  if (!gate(u)) { semiDrop.gate++; continue; }
  pushSemi(u, cls);
}
for (const x of Object.values(rdLots(D + 'olx9-flats.json').items)) {
  if (readyIds.has(x.id)) { semiDrop.ready++; continue; }
  const p = x.params || {};
  const u = {
    id: x.id, sku: x.sku, src: 'olx', kind: 'flat', title: x.title, link: x.link,
    price: usdOf(x), cur: 'USD',
    area: num(p['total_area:key']), rooms: ROOMS[p['number_of_rooms_string:key']] || num(p.number_of_rooms_string) || null,
    floor: num(p['floor:key'] || p.floor), floors: num(p['total_floors:key'] || p.total_floors),
    repair: p.repair || null, market: p.apartments_object_type || null, houseType: p.property_type_appartments_sale || null,
    isNew: /новобудова/i.test(p.apartments_object_type || ''),
    walls: p.house_type || null, heating: p.heating || null, bathroom: p.bathroom || null, comm: p.communications || null,
    noCommission: /без комісії/i.test(p.commission || ''),
    loc: x.loc, cityId: x.cityId, region: x.region, obl: L.REGION2SLUG[x.region] || null,
    lat: x.lat, lon: x.lon, created: x.created, days: daysSince(x.created),
    photos: x.photos || [], photoUrl: (x.photos || [])[0] || null, desc: x.desc, business: x.business,
  };
  if (!L.inBudget(u.price)) { semiDrop.budget++; continue; }
  if ((u.area || 0) < 50 || (u.rooms || 0) < 2) { semiDrop.small++; continue; }
  if (shareSemi(u)) { semiDrop.share++; continue; }
  const cls = (liveById[u.id] && liveById[u.id].attrs.semi) || L.semiClass(u);
  if (!cls) { semiDrop.noclass++; continue; }
  finish(u);
  if (!gate(u)) { semiDrop.gate++; continue; }
  pushSemi(u, cls);
}
// 6b. ЛУН: лоты с флагом unfinished из нормализатора
for (const x of lunClean) {
  if (!x.unfinished || !L.inBudget(x.price)) continue;
  if (readyIds.has(x.id)) continue;
  const u = shapeLun(x);
  const d = lunDet[u.id] || (ex(D + 'lun9-details.json') ? (rd(D + 'lun9-details.json')[u.id] || null) : null);
  if (d && !d.error) {
    if (num(d.area)) u.area = num(d.area);
    if (num(d.rooms)) u.rooms = num(d.rooms);
    if (num(d.land)) u.land = num(d.land);
    if (num(d.floor)) u.floor = num(d.floor);
    if (num(d.floors)) u.floors = num(d.floors);
    if ((d.photos || []).length) { u.photos = d.photos; u.photoUrl = d.photos[0]; }
    if (d.desc) u.desc = ((u.desc || '') + ' ' + d.desc).slice(0, 1200);
    if (d.gone) continue;
  }
  if (u.kind === 'house' && (u.area || 0) < 65) { semiDrop.small++; continue; }
  if (u.kind === 'flat' && ((u.area || 0) < 50 || ((u.rooms || 0) < 2 && u.rooms != null))) { semiDrop.small++; continue; }
  if (shareSemi(u)) { semiDrop.share++; continue; }
  const cls = L.semiClass(u) || (u.kind === 'flat' || L.SEMI_TXT.util.test(u.desc || '') ? 'shell' : null);
  if (!cls) { semiDrop.noclass++; continue; }
  finish(u);
  if (!gate(u) || u.obl === 'zak') { semiDrop.gate++; continue; }
  pushSemi(u, cls);
}
// 6c. перенесённые карточки прежней страницы, которых нет в свежем сборе
// (с 03.09.2026 к ним применяется тот же бюджет: нижняя граница поднята до $30 тыс.)
let liveKept = 0;
for (const s of semiLive) {
  if (seenSemi.has(s.id) || readyIds.has(s.id)) continue;
  const a = s.attrs;
  if (DEAD.has(s.id)) { drop.dead++; continue; }
  if (EXCLUDED.has(s.id)) { drop.excluded++; continue; }
  if (!L.inBudget(+a.price)) { semiDrop.budget++; continue; }
  const km = a.km === '' || a.km == null ? null : +a.km;
  if (km == null || km > KM_MAX) { drop.far++; continue; }
  const obl = L.oblastOf(s.lat, s.lon, shapes);
  if (obl === 'zak') { drop.zak++; continue; }
  const h = s.html;
  const img = (h.match(/<img src="(https:[^"]+)"/) || [])[1] || null;
  const u = {
    id: s.id, src: a.src || 'olx', kind: a.kind || 'house',
    title: (h.match(/rel="noopener">([^<]+)<\/a>/) || [])[1] || '', link: (h.match(/href="([^"]+)"/) || [])[1] || '',
    price: +a.price, km, obl, lat: s.lat, lon: s.lon, loc: s.loc,
    city: ((h.match(/<i>до ([^<]+)<\/i>/) || [])[1] || '').trim() || null,
    area: a.area ? +a.area : null, land: a.land ? +a.land : null, ppm: a.ppm ? +a.ppm : null,
    days: a.days ? +a.days : null, created: a.created ? a.created + 'T12:00:00+03:00' : null,
    photos: img ? [img] : [], photoUrl: img, noCommission: false, fromLive: true,
  };
  if (!u.city) { const n = L.nearestCity(u.lat, u.lon); u.city = n.city; }
  pushSemi(u, a.semi || 'unfin');
  liveKept++;
}
// 6d. топ-50 на область в каждом наборе источник×тип — как у готового
const semiSets = {};
for (const u of dedupe(semiCand)) {
  const k = u.src + '|' + u.kind;
  (semiSets[k] = semiSets[k] || []).push(u);
}
const semi = [];
pickTop(semiSets, semi, setStats, 'semi:');
// «к рынку области»: насколько цена за м² ниже медианы готового жилья того же типа в той же области
const median = arr => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
const medPpm = {};
for (const u of units) if (u.ppm) (medPpm[u.obl + '|' + u.kind] = medPpm[u.obl + '|' + u.kind] || []).push(u.ppm);
for (const k of Object.keys(medPpm)) medPpm[k] = median(medPpm[k]);
const medAll = { house: median(units.filter(u => u.kind === 'house' && u.ppm).map(u => u.ppm)), flat: median(units.filter(u => u.kind === 'flat' && u.ppm).map(u => u.ppm)) };
for (const u of semi) {
  const med = medPpm[u.obl + '|' + u.kind] || medAll[u.kind];
  u.medPpm = med || null;
  u.disc = med && u.ppm ? Math.round((1 - u.ppm / med) * 100) : null;
}

/* ════════ 7. один объект в разных источниках ════════ */
const all = [...units, ...semi];
const norm = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, "'").trim();
for (const u of all) u.dups = [];
for (let i = 0; i < all.length; i++) {
  for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.src === b.src) continue;
    if (a.kind !== b.kind) continue;
    if (!a.price || !b.price) continue;
    const dp = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
    if (dp > 0.02) continue;
    const sameLoc = norm(a.loc) && norm(a.loc) === norm(b.loc);
    const near = a.lat && b.lat && L.hav(a.lat, a.lon, b.lat, b.lon) < 1.2;
    if (!sameLoc && !near) continue;
    const aa = a.area, ba = b.area;
    const areaOk = aa && ba ? Math.abs(aa - ba) / Math.max(aa, ba) <= 0.05 : dp <= 0.005;
    if (!areaOk) continue;
    a.dups.push(b.id); b.dups.push(a.id);
  }
}
const dupN = all.filter(u => u.dups.length).length;

fs.writeFileSync(D + 'units9.json', JSON.stringify({ units, semi }));
fs.writeFileSync(D + 'vet-need.json', JSON.stringify(housesCand.map(u => ({
  id: u.id, obl: u.obl, quality: u.quality, km: u.km, city: u.city, price: u.price, area: u.area, land: u.land,
  photos: u.photos.slice(0, 4), title: u.title, link: u.link,
}))));
// новостройки без вердикта: фотопроверка «живые фото готового жилья или чистовая»
fs.writeFileSync(D + 'nb-need.json', JSON.stringify(nbCand.map(u => ({
  id: u.id, obl: u.obl, src: u.src, kind: u.kind, quality: u.quality, km: u.km, city: u.city,
  price: u.price, area: u.area, rooms: u.rooms, floor: u.floor, floors: u.floors,
  photos: (u.photos || []).slice(0, 4), title: u.title, link: u.link,
})), null, 1));

console.log('отброшено:', JSON.stringify(drop));
console.log('закреплённых (разбор семьи) оставлено:', pinnedKept);
setStats.forEach(s => console.log(s));
const oblCnt = {};
units.forEach(u => oblCnt[u.obl] = (oblCnt[u.obl] || 0) + 1);
console.log('готовых лотов:', units.length, 'по областям:', JSON.stringify(oblCnt));
console.log('получистовая: отбор', JSON.stringify(semiDrop), '| кандидатов', semiCand.length, '| в топах', semi.length, '| с прежней страницы', liveKept);
const semiCls = {}; semi.forEach(u => semiCls[u.semi] = (semiCls[u.semi] || 0) + 1);
console.log('получистовая по классам:', JSON.stringify(semiCls));
console.log('домов OLX ждёт фотопроверки:', housesCand.length, 'из них по областям:',
  JSON.stringify(housesCand.reduce((m, u) => { m[u.obl] = (m[u.obl] || 0) + 1; return m; }, {})));
console.log('новострой: в каталоге', units.filter(u => u.isNew).length,
  '| отклонено по фото (чистовая/план/рендер)', drop.nbShell,
  '| без фото', drop.nbNoPhoto, '| ждёт фотопроверки', drop.nbWait);
console.log('лотов с дублем в другом источнике:', dupN);
