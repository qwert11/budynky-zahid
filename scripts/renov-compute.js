// Смета «сколько будет стоить ремонт, чтобы жить» — лайт/норм/люкс для получистовой и
// чистовой от застройщика (просьба покупателя 08.09.2026: «проверь по картинкам... и в
// карточках этих пропиши»). Фото 149 лотов просмотрены по сеткам renov-grid.js (19 сеток,
// data/vet/renov/renov-00..18.png) — внутри каждого класса «что готово» состояние на фото
// однородное (см. README), поэтому доля площади под полную отделку берётся по классу, а не
// придумывается на глаз по каждому лоту отдельно. Точечные случаи (нет фото вовсе) правит
// data/renov-frac.json, если там есть запись для конкретного id — она главнее дефолта класса.
//
// Ставки — Западная Украина, 2026, «под ключ» (работа + материалы), $/м² на площадь,
// которую реально надо доводить с нуля (от бетона/стяжки до жилого):
//   лайт  120 $/м² — минимально жилой: стяжка/плитка-ламинат эконом, штукатурка+покраска,
//                    бюджетная сантехника и кухня, межкомнатные двери
//   норм  220 $/м² — среднего уровня евроремонт, нормальные материалы, полная электрика/сантехника
//   люкс  400 $/м² — дизайнерская отделка, материалы и техника премиум-класса
// Источники (не точный прайс для конкретного адреса, ориентир по рынку): pricesua.com/remont-kvartyry-2026,
// nsdgroup.com.ua/stoimost, rabotniki.ua/price/ivanofrankovsk. Национальные цифры (Киев) идут
// с поправкой вниз на западнорегиональные расценки на работу.
//
// Класс «repair» (жилая, но требует ремонта — типичная советская вторичка с обоями/паркетом,
// подтверждено по фото: всё оформлено, но морально устарело) — исключение: лайт здесь не
// «с нуля», а косметика поверх уже жилого ремонта (покраска, освежить пол, по мелочи),
// заметно дешевле — 70 $/м². Норм/люкс всё равно требуют содрать старое подчистую, поэтому
// считаются по тем же ставкам «с нуля», что и остальные классы.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const { semi, raw } = JSON.parse(fs.readFileSync(D + 'units9.json', 'utf8'));
const overrides = fs.existsSync(D + 'renov-frac.json') ? JSON.parse(fs.readFileSync(D + 'renov-frac.json', 'utf8')) : {};

const RATE = { light: 120, normal: 220, lux: 400 };
const RATE_DATED_LIGHT = 70;
// доля площади лота, которую реально надо доводить «с нуля» — по классу «получистовая»
// (устанавливается по фото, см. шапку файла); «raw» — чистовая от застройщика, всегда 1
const CLASS_FRAC = {
  repair: 1, unfin: 0.8, part: 0.5, floor: 0.5, annex: 0.45, while: 0.25,
};
const round = (n) => Math.round(n / 50) * 50;

function estimate(u) {
  const isRaw = u.ready === 'raw';
  const cls = u.semi;
  const ov = overrides[u.id];
  const frac = ov && typeof ov.frac === 'number' ? ov.frac : (isRaw ? 1 : (CLASS_FRAC[cls] != null ? CLASS_FRAC[cls] : 0.8));
  const area = u.area || 0;
  const lightRate = (!isRaw && cls === 'repair') ? RATE_DATED_LIGHT : RATE.light;
  const light = round(area * (cls === 'repair' && !isRaw ? 1 : frac) * lightRate);
  const normal = round(area * frac * RATE.normal);
  const lux = round(area * frac * RATE.lux);
  return { frac, light, normal, lux, note: ov && ov.note || null };
}

const out = {};
for (const u of [...semi, ...raw]) out[u.id] = estimate(u);
fs.writeFileSync(D + 'renov.json', JSON.stringify(out, null, 1));

const cnt = { repair: 0, unfin: 0, part: 0, floor: 0, annex: 0, while: 0, raw: 0 };
for (const u of [...semi, ...raw]) cnt[u.ready === 'raw' ? 'raw' : u.semi] = (cnt[u.ready === 'raw' ? 'raw' : u.semi] || 0) + 1;
console.log('смет посчитано:', Object.keys(out).length, JSON.stringify(cnt));
console.log('пример (получистовая:repair)', JSON.stringify(estimate(semi.find(u => u.semi === 'repair') || {})));
console.log('пример (чистовая от застройщика)', JSON.stringify(estimate(raw[0] || {})));
