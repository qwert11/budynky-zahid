// Просмотры объявлений OLX для лотов каталога: GraphQL PageViews (авторизация ANONYMOUS).
// numeric adId = sku из пула. → data/views9.json {id: {views, at}}
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const OUT = D + 'views9.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { units } = JSON.parse(fs.readFileSync(D + 'units9.json', 'utf8'));
const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const Q = 'query PageViews($adId: String!) {\n  myAds {\n    pageViews(adId: $adId) {\n      pageViews\n    }\n  }\n}';
async function views(sku) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch('https://production-graphql.eu-sharedservices.olxcdn.com/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'ANONYMOUS', site: 'olxua', 'user-agent': 'Mozilla/5.0' },
        body: JSON.stringify({ operationName: 'PageViews', variables: { adId: String(sku) }, query: Q }),
      });
      if (!r.ok) { await sleep(1200 * (t + 1)); continue; }
      const j = await r.json();
      const v = j && j.data && j.data.myAds && j.data.myAds.pageViews;
      return v ? v.pageViews : null;
    } catch { await sleep(800 * (t + 1)); }
  }
  return null;
}

(async () => {
  // null в кэше = прошлая неудача, пробуем снова
  const todo = units.filter(u => u.src === 'olx' && u.sku && (cache[u.id] === undefined || cache[u.id] === null));
  console.log('лотов OLX без просмотров:', todo.length);
  let n = 0, ok = 0;
  for (const u of todo) {
    const v = await views(u.sku);
    cache[u.id] = v == null ? null : { views: v, at: new Date().toISOString().slice(0, 10) };
    if (v != null) ok++;
    n++;
    if (n % 40 === 0) { fs.writeFileSync(OUT, JSON.stringify(cache)); console.log(' ', n, '/', todo.length, 'получено', ok); }
    await sleep(180);
  }
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log('готово:', n, 'запрошено,', ok, 'с просмотрами');
})();
