import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUpdate, webhookSecret } from '../src/telegram.js';
import { renderCrmPage } from '../src/crm.js';
import worker from '../src/worker.js';

const NOW = new Date(Date.UTC(2026, 9, 22, 9, 0));

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (id) => (data.has(id) ? structuredClone(data.get(id)) : null),
    put: async (lead) => { data.set(lead.chat_id, structuredClone(lead)); },
    list: async () => [...data.values()],
  };
}

function setup() {
  const sent = [];
  const tg = async (method, payload) => { sent.push({ method, ...payload }); return { ok: true }; };
  const store = memoryStore();
  let id = 0;
  const say = (text, chatId = 42) => handleUpdate({
    update_id: ++id,
    message: { message_id: id, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Маша', username: 'masha' }, text },
  }, { tg, store, adminChatId: '777', now: NOW });
  const replies = (chatId = 42) => sent.filter((m) => m.method === 'sendMessage' && m.chat_id === chatId).map((m) => m.text);
  return { sent, store, say, replies };
}

test('полный диалог: анкета → карточка → прогноз → горячий лид', async () => {
  const { store, say, replies, sent } = setup();

  await say('/start');
  assert.match(replies().at(-1), /Как вас зовут полностью/);
  assert.equal(store.data.get(42).stage, 'Новый');

  await say('Мария');
  assert.match(replies().at(-1), /полное имя/, 'одно имя — переспрашивает');

  await say('иванова мария петровна');
  assert.match(replies().at(-1), /Приятно познакомиться, Мария/);
  assert.equal(store.data.get(42).full_name, 'Иванова Мария Петровна');

  await say('31.02.1990');
  assert.match(replies().at(-1), /не существует/);

  await say('14 марта 1990');
  assert.equal(store.data.get(42).birth_date, '14.03.1990');
  assert.match(replies().at(-1), /в каком городе/);

  await say('Казань');
  const lead = store.data.get(42);
  assert.equal(lead.birth_place, 'Казань');
  assert.equal(lead.zodiac, 'Рыбы');
  assert.equal(lead.life_path_number, 9);
  assert.equal(lead.forecast_sent, true);
  assert.equal(lead.stage, 'Бесплатный прогноз');
  const forecast = replies().find((t) => t.startsWith('🔮 Мария, ваш бесплатный прогноз'));
  assert.ok(forecast, 'прогноз отправлен');
  assert.match(forecast, /Нажмите «Хочу полный разбор»/);
  assert.ok(sent.some((m) => m.method === 'sendChatAction'));

  const admin = replies('777');
  assert.equal(admin.length, 1);
  assert.match(admin[0], /Новый лид/);
  assert.match(admin[0], /@masha/);
  assert.match(admin[0], /ФИО: Иванова Мария Петровна/);

  await say('🔮 Хочу полный разбор');
  assert.equal(store.data.get(42).stage, 'Хочет полный разбор');
  assert.match(replies('777').at(-1), /Горячий лид/);
  await say('Хочу полный разбор');
  assert.equal(replies('777').length, 2, 'повторный запрос не дублирует уведомление');

  await say('/card');
  assert.match(replies().at(-1), /Стадия: Хочет полный разбор/);

  const history = store.data.get(42).history.map((h) => h.text);
  assert.ok(history.includes('Стадия → Анкета заполнена'));
  assert.ok(history.includes('Поле «Дата рождения» = 14.03.1990'));
});

test('без /start бот сразу начинает анкету, «Пройти заново» перезапускает', async () => {
  const { store, say, replies } = setup();
  await say('привет');
  assert.match(replies().at(-1), /Как вас зовут полностью/);
  await say('Петров Пётр');
  await say('🔄 Пройти заново');
  assert.equal(store.data.get(42).step, 'name');
  assert.match(replies().at(-1), /Как вас зовут полностью/);
});

test('нетекстовое сообщение и групповые чаты', async () => {
  const { say, replies, sent } = setup();
  await say('/start');
  await say(undefined);
  assert.match(replies().at(-1), /текстом/);
  const before = sent.length;
  await handleUpdate({ message: { chat: { id: -1, type: 'group' }, text: '/start' } }, { tg: async () => sent.push(1), store: memoryStore() });
  assert.equal(sent.length, before);
});

test('страница CRM экранирует данные клиентов', () => {
  const html = renderCrmPage([{
    chat_id: 1, tg_username: 'x', stage: 'Бесплатный прогноз', full_name: '<script>alert(1)</script>',
    birth_date: '14.03.1990', birth_place: 'Казань', zodiac: 'Рыбы', life_path_number: 9,
    history: [{ at: NOW.toISOString(), text: 'Создана карточка клиента' }], updated_at: NOW.toISOString(),
  }]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Бесплатный прогноз: <b>1</b>'));
});

test('вебхук Telegram проверяет секрет, /crm и /setup — пароль', async () => {
  const env = { BOT_TOKEN: '123:abc', ADMIN_KEY: 'pass', LEADS: {} };
  const post = (headers) => worker.fetch(new Request('https://x/telegram', { method: 'POST', headers, body: '{}' }), env);
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ 'X-Telegram-Bot-Api-Secret-Token': await webhookSecret('123:abc') })).status, 200);
  assert.equal((await worker.fetch(new Request('https://x/crm'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://x/setup?key=wrong'), env)).status, 401);
});
