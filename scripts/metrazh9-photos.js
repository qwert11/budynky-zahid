// Разовый бэкфилл фото для уже отобранных (прошедших проверку зеркал) лотов Metrazh:
// карточка поиска фото не даёт, страница объявления — даёт полную галерею.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

(async () => {
  const items = JSON.parse(fs.readFileSync(D + 'metrazh9-candidates.json', 'utf8'));
  let ok = 0, none = 0, failed = 0;
  for (const it of items) {
    if ((it.photoList || []).length) { ok++; continue; }
    const html = await fetchHtml(it.url);
    if (!html) { failed++; await sleep(1200); continue; }
    const photos = [...html.matchAll(/data-src="(https:\/\/metrazh\.com\.ua\/files\/images\/[^"]+\.jpe?g)"/g)]
      .map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    if (photos.length) { it.photoList = photos; ok++; } else none++;
    await sleep(1300 + Math.random() * 600);
  }
  fs.writeFileSync(D + 'metrazh9-candidates.json', JSON.stringify(items));
  console.log('фото добавлено/уже было:', ok, '| без фото на странице:', none, '| не открылось:', failed, '| всего:', items.length);
})();
