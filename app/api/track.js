// POST /api/track — события приложения: open (визит), view (просмотр товара), cart (добавление в заказ).
const store = require('./_lib/store');
const { validateInitData } = require('./_lib/max');
const CATALOG = require('./_lib/products.json');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!store.enabled()) return res.status(204).end();
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  try {
    if (b.e === 'open') {
      const auth = validateInitData(b.initData, process.env.MAX_BOT_TOKEN);
      const raw = auth && auth.user && auth.user.id ? 'm' + auth.user.id : /^[a-z0-9]{8,32}$/i.test(b.uid || '') ? 'a' + b.uid : null;
      if (raw) await store.trackVisit(store.hid(raw));
    } else if ((b.e === 'view' || b.e === 'cart') && typeof b.id === 'string' && CATALOG[b.id]) {
      await store.trackEvent(b.e, b.id);
    }
  } catch (e) { console.error('track', e.message); }
  return res.status(204).end();
};
