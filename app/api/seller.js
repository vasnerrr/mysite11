// /api/seller — данные для продавца. Доступ по PIN из переменной SELLER_PIN (заголовок X-Seller-Pin).
// GET ?days=7  -> аналитика и последние заказы;  POST {action:'status', id, status} -> статус заказа.
const crypto = require('node:crypto');
const store = require('./_lib/store');

function pinOk(req) {
  const pin = process.env.SELLER_PIN || '', got = String(req.headers['x-seller-pin'] || '');
  if (!pin || got.length !== pin.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(pin));
}

module.exports = async function handler(req, res) {
  if (!pinOk(req)) return res.status(401).json({ ok: false, error: 'Неверный PIN' });
  if (!store.enabled()) return res.status(200).json({ ok: true, enabled: false });
  try {
    if (req.method === 'POST') {
      let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      if (b && b.action === 'status' && /^[\w-]{1,20}$/.test(b.id || '') && ['new', 'ready', 'done', 'cancel'].includes(b.status)) {
        await store.setStatus(b.id, b.status); return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'Неверный запрос' });
    }
    const days = Math.min(90, Math.max(1, parseInt(req.query && req.query.days, 10) || 7));
    return res.status(200).json({ ok: true, ...(await store.stats(days)) });
  } catch (e) {
    console.error('seller', e.message);
    return res.status(500).json({ ok: false, error: 'Ошибка хранилища' });
  }
};
