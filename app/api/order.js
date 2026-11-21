// POST /api/order — принимает заказ из мини-приложения и отправляет его админам в личку MAX.
const { sendToUser, validateInitData, adminIds, esc } = require('./_lib/max');
const CATALOG = require('./_lib/products.json'); // id -> [название, цена из прайса, ед., раздел]
const store = require('./_lib/store');

const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const fmtQ = (q, u) => (u === 'кг' ? (q < 1 ? Math.round(q * 1000) + ' г' : String(q).replace('.', ',') + ' кг') : q + ' шт');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function parseOrder(o) {
  if (!o || typeof o !== 'object') throw new Error('Пустой заказ');
  const name = str(o.name, 60), phone = str(o.phone, 30);
  if (!name) throw new Error('Не указано имя');
  if (phone.replace(/\D/g, '').length < 10) throw new Error('Неверный телефон');
  const method = o.method === 'delivery' ? 'delivery' : 'pickup';
  const addr = str(o.addr, 200), com = str(o.com, 500);
  if (method === 'delivery' && !addr) throw new Error('Не указан адрес');
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > 80) throw new Error('Пустая корзина');
  const items = o.items.map(i => {
    const q = Number(i.q);
    if (!(q > 0 && q <= 100)) throw new Error('Неверное количество');
    const id = str(i.id, 20), c = CATALOG[id];
    const clientPrice = Number(i.p) || 0;
    if (c) {
      const [n, listPrice, u] = c;
      // Акция продавца может снизить цену, но не больше чем на MAX_DISCOUNT% от прайса —
      // иначе считаем по прайсу (защита от подделки цены). Админ видит обе цены.
      const floor = listPrice * (1 - (Number(process.env.MAX_DISCOUNT) || 50) / 100);
      const p = clientPrice >= floor && clientPrice <= listPrice ? clientPrice : listPrice;
      return { id, n, u, q, p, listPrice, sum: Math.round(p * q) };
    }
    return { id, n: str(i.n, 120) || id, u: i.u === 'кг' ? 'кг' : 'шт', q, p: clientPrice, sum: Math.round(clientPrice * q), custom: true };
  });
  return { id: str(o.id, 20) || 'KM-' + String(Date.now()).slice(-5), name, phone, method, addr, com, items,
           total: items.reduce((s, i) => s + i.sum, 0) };
}

function formatOrder(o, maxUser) {
  const hasKg = o.items.some(i => i.u === 'кг');
  const lines = o.items.map(i =>
    `• ${esc(i.n)} — ${fmtQ(i.q, i.u)} × ${rub(i.p)} = <b>${rub(i.sum)}</b>` +
    (i.listPrice && i.p < i.listPrice ? ` (акция, в прайсе ${rub(i.listPrice)})` : '') +
    (i.custom ? ' (новый товар)' : '') + ` [${esc(i.id)}]`);
  const who = maxUser ? `\nMAX: ${esc([maxUser.first_name, maxUser.last_name].filter(Boolean).join(' '))}${maxUser.username ? ' @' + esc(maxUser.username) : ''} (id ${esc(maxUser.id)})` : '';
  return [
    `🦀 <b>Новый заказ ${esc(o.id)}</b>`,
    `👤 ${esc(o.name)}, ${esc(o.phone)}${who}`,
    o.method === 'delivery' ? `🚚 Доставка: ${esc(o.addr)}` : '🏪 Самовывоз: Кукунина 9Г, корп. 1',
    '',
    ...lines,
    '',
    `💰 Итого${hasKg ? ' ≈' : ''}: <b>${rub(o.total)}</b>${hasKg ? ' (весовые — после взвешивания)' : ''}`,
    o.com ? `💬 ${esc(o.com)}` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

module.exports = async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  let order;
  try { order = parseOrder(body && body.order); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  const auth = validateInitData(body.initData, process.env.MAX_BOT_TOKEN);
  if (process.env.REQUIRE_MAX_AUTH === '1' && !auth) return res.status(403).json({ ok: false, error: 'Откройте приложение в MAX' });

  // аналитика: сохраняем заказ (ошибка хранилища не мешает отправке заказа)
  const uidRaw = auth && auth.user && auth.user.id ? 'm' + auth.user.id : /^[a-z0-9]{8,32}$/i.test(body.uid || '') ? 'a' + body.uid : '';
  try { await store.recordOrder(order, uidRaw ? store.hid(uidRaw) : '', CATALOG); } catch (e) { console.error('store', e.message); }

  const admins = adminIds();
  if (!admins.length) return res.status(500).json({ ok: false, error: 'ADMIN_IDS не настроены' });

  const text = formatOrder(order, auth && auth.user);
  const results = await Promise.allSettled(admins.map(id => sendToUser(id, text)));
  const delivered = results.filter(r => r.status === 'fulfilled').length;
  results.forEach((r, i) => r.status === 'rejected' && console.error('MAX send failed for', admins[i], r.reason && r.reason.message));
  if (!delivered) return res.status(502).json({ ok: false, error: 'Не удалось доставить заказ' });
  return res.status(200).json({ ok: true, id: order.id, delivered });
};
module.exports.parseOrder = parseOrder;
module.exports.formatOrder = formatOrder;
