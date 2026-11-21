// POST /api/bot — вебхук бота MAX. Отвечает на /start и /id: присылает пользователю его MAX ID,
// чтобы добавить его в ADMIN_IDS (получатели заказов).
const { sendToUser, adminIds } = require('./_lib/max');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-max-bot-api-secret'] !== secret) return res.status(401).end();

  let u = req.body;
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch (e) { u = {}; } }
  u = u || {};
  let userId = null, text = '';
  if (u.update_type === 'bot_started') { userId = u.user && u.user.user_id; text = '/start'; }
  if (u.update_type === 'message_created') {
    userId = u.message && u.message.sender && u.message.sender.user_id;
    text = (u.message && u.message.body && u.message.body.text || '').trim().toLowerCase();
  }
  if (userId && /^\/(start|id)\b/.test(text)) {
    const isAdmin = adminIds().includes(String(userId));
    const msg = isAdmin
      ? `Здравствуйте! Вы — администратор «Краба Море». Новые заказы из мини-приложения будут приходить сюда.\nВаш MAX ID: <b>${userId}</b>`
      : `Здравствуйте! Это бот магазина «Краба Море».\nВаш MAX ID: <b>${userId}</b>\nЧтобы получать заказы, передайте этот номер разработчику — он добавит его в список администраторов.`;
    try { await sendToUser(userId, msg); } catch (e) { console.error(e.message); }
  }
  return res.status(200).json({ ok: true });
};
