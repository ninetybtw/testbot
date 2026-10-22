import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../src/miniapp.js';
import worker from '../src/worker.js';

const TOKEN = '123456:TEST-token';

// initData так, как его подписывает Telegram.
function signInitData(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const USER = { id: 4242, first_name: 'Маша', username: 'masha' };
const fresh = () => String(Math.floor(Date.now() / 1000));

function memoryKv() {
  const data = new Map();
  return {
    data,
    get: async (k, type) => (data.has(k) ? (type === 'json' ? JSON.parse(data.get(k)) : data.get(k)) : null),
    put: async (k, v) => { data.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

function env(extra = {}) {
  return { BOT_TOKEN: TOKEN, ADMIN_KEY: 'pass', LEADS: memoryKv(), ADMIN_CHAT_ID: '777', TELEGRAM_API: 'https://tg.test', ...extra };
}

// Перехватываем вызовы Telegram API.
function mockTelegram() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: true }));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const post = (path, body, e) => worker.fetch(new Request(`https://bot.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), e);

test('проверка initData: подпись, токен, срок', async () => {
  const good = signInitData({ user: JSON.stringify(USER), auth_date: fresh(), query_id: 'AAH' });
  assert.deepEqual(await verifyInitData(good, TOKEN), USER);
  assert.equal(await verifyInitData(good, 'other:token'), null);
  assert.equal(await verifyInitData(good.replace('4242', '4243'), TOKEN), null);
  const old = signInitData({ user: JSON.stringify(USER), auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400) });
  assert.equal(await verifyInitData(old, TOKEN), null);
  // Поле signature из новых версий Telegram не мешает проверке.
  const withSignature = signInitData({ user: JSON.stringify(USER), auth_date: fresh(), signature: 'abc' });
  assert.deepEqual(await verifyInitData(withSignature, TOKEN), USER);
  assert.equal(await verifyInitData('', TOKEN), null);
});

test('Mini App: страница отдаётся', async () => {
  const res = await worker.fetch(new Request('https://bot.test/app'), env());
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /telegram-web-app\.js/);
  assert.match(html, /Что звёзды говорят о вас/);
});

test('Mini App: прогноз из Telegram пишется в карточку, уходит в чат и админу', async () => {
  const tg = mockTelegram();
  try {
    const e = env();
    const initData = signInitData({ user: JSON.stringify(USER), auth_date: fresh() });
    const res = await post('/app/api/forecast', { initData, name: 'иванова мария петровна', birth_date: '1990-03-14', birth_place: 'Казань' }, e);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.saved, true);
    assert.equal(body.sections.sign.name, 'Рыбы');
    assert.equal(body.sections.numbers.length, 4);

    const lead = JSON.parse(e.LEADS.data.get('lead:4242'));
    assert.equal(lead.full_name, 'Иванова Мария Петровна');
    assert.equal(lead.birth_date, '14.03.1990');
    assert.equal(lead.stage, 'Бесплатный прогноз');
    assert.equal(lead.source, 'Mini App');
    assert.equal(lead.step, 'done');

    const sent = tg.calls.map((c) => c.body);
    assert.ok(sent.some((m) => m.chat_id === 4242 && m.text.startsWith('🔮 Мария')), 'прогноз продублирован в чат');
    assert.ok(sent.some((m) => m.chat_id === '777' && /Mini App/.test(m.text)), 'уведомление админу');

    const full = await post('/app/api/full', { initData }, e);
    assert.deepEqual(await full.json(), { ok: true, saved: true });
    assert.equal(JSON.parse(e.LEADS.data.get('lead:4242')).stage, 'Хочет полный разбор');
    assert.ok(tg.calls.some((c) => c.body.chat_id === '777' && /Горячий лид/.test(c.body.text)));
  } finally {
    tg.restore();
  }
});

test('Mini App: в браузере без Telegram считает, но не сохраняет; ошибки ввода и подделка', async () => {
  const e = env();
  const preview = await (await post('/app/api/forecast', { name: 'Петров Пётр', birth_date: '02.08.1985', birth_place: 'Самара' }, e)).json();
  assert.equal(preview.ok, true);
  assert.equal(preview.saved, false);
  assert.equal(e.LEADS.data.size, 0);

  const bad = await post('/app/api/forecast', { name: 'Пётр', birth_date: '1985-08-02', birth_place: 'Самара' }, e);
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).field, 'name');

  const forged = signInitData({ user: JSON.stringify(USER), auth_date: fresh() }, 'other:token');
  const res = await post('/app/api/forecast', { initData: forged, name: 'Петров Пётр', birth_date: '1985-08-02', birth_place: 'Самара' }, e);
  assert.equal(res.status, 401);
});
