// Самостоятельный Telegram-бот: анкета → карточка клиента → бесплатный прогноз.
// Пока TorroCRM не подключён, карточки хранятся в Cloudflare KV и видны на странице /crm.

import { makeForecast, parseFullName, parseBirthDate, parseBirthPlace, InputError } from './forecast.js';

export const STAGES = ['Новый', 'Анкета заполнена', 'Бесплатный прогноз', 'Хочет полный разбор'];
const [NEW, FORM_DONE, FREE_FORECAST, WANTS_FULL] = STAGES;

const BTN_FULL = '🔮 Хочу полный разбор';
const BTN_RESTART = '🔄 Пройти заново';

const KB_REMOVE = { reply_markup: { remove_keyboard: true } };
const KB_DONE = { reply_markup: { keyboard: [[{ text: BTN_FULL }], [{ text: BTN_RESTART }]], resize_keyboard: true } };
export const BTN_APP = '✨ Открыть приложение';
const kbApp = (url) => ({ reply_markup: { inline_keyboard: [[{ text: BTN_APP, web_app: { url } }]] } });

export { KB_DONE };

export const BOT_UPSELL = 'Это короткая версия. В полном персональном разборе — прогноз на 12 месяцев по месяцам, любовь и совместимость, деньги и предназначение, а также благоприятные даты для важных решений. Нажмите «Хочу полный разбор», и я расскажу, как его получить.';

const TEXT = {
  greeting: 'Здравствуйте! Я Астра 🔮 Составлю для вас бесплатный персональный прогноз по имени, дате и месту рождения.\n\nОтвечая на вопросы, вы соглашаетесь, что эти данные будут использованы для составления прогноза.',
  greetingApp: 'Здравствуйте! Я Астра 🔮 Составлю для вас бесплатный персональный прогноз по имени, дате и месту рождения.\n\nОткройте приложение — там прогноз оформлен красиво, — или ответьте на три вопроса прямо здесь, в чате.\n\nОтвечая на вопросы, вы соглашаетесь, что эти данные будут использованы для составления прогноза.',
  askName: 'Как вас зовут полностью — фамилия, имя и отчество?',
  askDate: (firstName) => `Приятно познакомиться, ${firstName}! Когда вы родились? Напишите дату, например 14.03.1990.`,
  askPlace: 'И последнее: в каком городе или населённом пункте вы родились?',
  counting: (firstName) => `Спасибо, ${firstName}! Считаю вашу карту — это займёт несколько секунд ✨`,
  textOnly: 'Пожалуйста, напишите ответ текстом 🙏',
  wantsFull: 'Отлично! Передала вашу заявку астрологу — он напишет вам здесь в течение дня и расскажет, как получить полный разбор ✨',
  afterForecast: 'Если захотите полный разбор на 12 месяцев — нажмите кнопку «Хочу полный разбор». Пройти заново — «Пройти заново».',
};

// ---------- Внешние зависимости (подменяются в тестах) ----------

export function telegramApi(token, base = 'https://api.telegram.org') {
  return async (method, payload) => {
    const res = await fetch(`${base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!data.ok) console.log(`telegram ${method} failed: ${data.description}`);
    return data;
  };
}

export function kvStore(kv) {
  return {
    get: (chatId) => kv.get(`lead:${chatId}`, 'json'),
    put: (lead) => kv.put(`lead:${lead.chat_id}`, JSON.stringify(lead)),
    async list() {
      const keys = [];
      let cursor;
      do {
        const page = await kv.list({ prefix: 'lead:', cursor });
        keys.push(...page.keys.map((k) => k.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const leads = await Promise.all(keys.map((k) => kv.get(k, 'json')));
      return leads.filter(Boolean).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
  };
}

// Секрет вебхука выводится из токена, чтобы не заводить ещё одну переменную.
export async function webhookSecret(botToken) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`webhook:${botToken}`));
  return [...new Uint8Array(digest)].slice(0, 24).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Карточка клиента ----------

export function newLead(user, now) {
  return {
    chat_id: user.id,
    tg_username: user.username || '',
    tg_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
    stage: NEW,
    step: null,
    source: null,
    full_name: null,
    first_name: null,
    birth_date: null,
    birth_place: null,
    zodiac: null,
    life_path_number: null,
    forecast_sent: false,
    history: [{ at: now.toISOString(), text: 'Создана карточка клиента' }],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function log(lead, now, text) {
  lead.history.push({ at: now.toISOString(), text });
  if (lead.history.length > 60) lead.history = lead.history.slice(-60);
  lead.updated_at = now.toISOString();
}

function setField(lead, now, key, label, value) {
  lead[key] = value;
  log(lead, now, `Поле «${label}» = ${value}`);
}

function setStage(lead, now, stage) {
  if (lead.stage === stage) return;
  lead.stage = stage;
  log(lead, now, `Стадия → ${stage}`);
}

// Прогноз выдан: записать результаты в карточку и сдвинуть стадию.
export function recordForecast(lead, result, now, source) {
  if (lead.full_name !== result.data.full_name) setField(lead, now, 'full_name', 'ФИО', result.data.full_name);
  if (lead.birth_date !== result.data.birth_date) setField(lead, now, 'birth_date', 'Дата рождения', result.data.birth_date);
  if (lead.birth_place !== result.data.birth_place) setField(lead, now, 'birth_place', 'Место рождения', result.data.birth_place);
  lead.first_name = result.data.first_name;
  setStage(lead, now, FORM_DONE);
  setField(lead, now, 'zodiac', 'Знак зодиака', result.data.zodiac);
  setField(lead, now, 'life_path_number', 'Число судьбы', result.data.life_path_number);
  lead.forecast_sent = true;
  lead.source = source;
  lead.step = 'done';
  log(lead, now, `Поле «Прогноз выдан» = Да (${source})`);
  setStage(lead, now, FREE_FORECAST);
}

// Клиент попросил полный разбор. Возвращает true, если это впервые.
export function recordWantsFull(lead, now) {
  const first = lead.stage !== WANTS_FULL;
  setStage(lead, now, WANTS_FULL);
  return first;
}

export const NOTIFY = {
  forecast: (source) => `✨ Новый лид: выдан бесплатный прогноз (${source})`,
  wantsFull: '🔥 Горячий лид: хочет полный разбор',
};

export function cardText(lead, title = '📇 Карточка клиента в CRM') {
  const who = lead.tg_username ? `@${lead.tg_username}` : lead.tg_name || `chat ${lead.chat_id}`;
  return [
    title,
    `Клиент в Telegram: ${who}`,
    `Стадия: ${lead.stage}`,
    ...(lead.source ? [`Источник: ${lead.source}`] : []),
    `ФИО: ${lead.full_name ?? '—'}`,
    `Дата рождения: ${lead.birth_date ?? '—'}`,
    `Место рождения: ${lead.birth_place ?? '—'}`,
    `Знак зодиака: ${lead.zodiac ?? '—'}`,
    `Число судьбы: ${lead.life_path_number ?? '—'}`,
    `Прогноз выдан: ${lead.forecast_sent ? 'Да' : 'Нет'}`,
  ].join('\n');
}

// ---------- Диалог ----------

/**
 * Обрабатывает одно обновление Telegram.
 * @param {object} update  — объект Update из Telegram
 * @param {{tg: Function, store: object, adminChatId?: string, upsell?: string, appUrl?: string, now?: Date}} deps
 */
export async function handleUpdate(update, deps) {
  const msg = update.message;
  if (!msg || msg.chat?.type !== 'private') return;

  const { tg, store } = deps;
  const now = deps.now ?? new Date();
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const send = (body, extra = {}) => tg('sendMessage', { chat_id: chatId, text: body, ...extra });
  const notifyAdmin = (title, lead) => deps.adminChatId
    ? tg('sendMessage', { chat_id: deps.adminChatId, text: cardText(lead, title) })
    : undefined;

  if (text === '/id') {
    await send(`ID этого чата: ${chatId}`);
    return;
  }

  let lead = await store.get(chatId);
  const isNew = !lead;
  if (isNew) lead = newLead(msg.from ?? { id: chatId }, now);

  if (text === '/card' && !isNew) {
    await send(cardText(lead));
    return;
  }

  if (isNew || !lead.step || text.startsWith('/start') || text === BTN_RESTART) {
    if (!isNew) log(lead, now, 'Клиент начал анкету заново');
    lead.step = 'name';
    await store.put(lead);
    if (deps.appUrl) await send(TEXT.greetingApp, kbApp(deps.appUrl));
    else await send(TEXT.greeting);
    await send(TEXT.askName, KB_REMOVE);
    return;
  }

  if (!text) {
    await send(TEXT.textOnly);
    return;
  }

  try {
    if (lead.step === 'name') {
      const name = parseFullName(text);
      setField(lead, now, 'full_name', 'ФИО', name.full);
      lead.first_name = name.firstName;
      lead.step = 'date';
      await store.put(lead);
      await send(TEXT.askDate(name.firstName));
      return;
    }

    if (lead.step === 'date') {
      const d = parseBirthDate(text, now);
      setField(lead, now, 'birth_date', 'Дата рождения', `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`);
      lead.step = 'place';
      await store.put(lead);
      await send(TEXT.askPlace);
      return;
    }

    if (lead.step === 'place') {
      setField(lead, now, 'birth_place', 'Место рождения', parseBirthPlace(text));
      setStage(lead, now, FORM_DONE);
      await store.put(lead);
      await send(TEXT.counting(lead.first_name));
      await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

      const result = makeForecast(
        { name: lead.full_name, firstName: lead.first_name, birthDate: lead.birth_date, birthPlace: lead.birth_place },
        { now, upsell: deps.upsell ?? BOT_UPSELL },
      );
      await send(result.text, KB_DONE);
      recordForecast(lead, result, now, 'чат');
      await store.put(lead);
      await notifyAdmin(NOTIFY.forecast('чат'), lead);
      return;
    }
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    await send(e.message);
    return;
  }

  // Анкета пройдена, прогноз выдан.
  if (/разбор|хочу/i.test(text)) {
    const first = recordWantsFull(lead, now);
    await store.put(lead);
    await send(TEXT.wantsFull, KB_DONE);
    if (first) await notifyAdmin(NOTIFY.wantsFull, lead);
    return;
  }
  await send(TEXT.afterForecast, KB_DONE);
}
