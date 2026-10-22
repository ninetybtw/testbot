import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeForecast, zodiacSign, easternYear, lifePathNumber, parseBirthDate, parseFullName, parseBirthPlace, InputError,
} from '../src/forecast.js';
import worker from '../src/worker.js';

const NOW = new Date(Date.UTC(2026, 9, 22));

test('знаки зодиака на границах', () => {
  assert.equal(zodiacSign(1, 1).name, 'Козерог');
  assert.equal(zodiacSign(19, 1).name, 'Козерог');
  assert.equal(zodiacSign(20, 1).name, 'Водолей');
  assert.equal(zodiacSign(20, 3).name, 'Рыбы');
  assert.equal(zodiacSign(21, 3).name, 'Овен');
  assert.equal(zodiacSign(22, 7).name, 'Рак');
  assert.equal(zodiacSign(23, 7).name, 'Лев');
  assert.equal(zodiacSign(21, 12).name, 'Стрелец');
  assert.equal(zodiacSign(22, 12).name, 'Козерог');
  assert.equal(zodiacSign(31, 12).name, 'Козерог');
});

test('восточный гороскоп', () => {
  assert.equal(easternYear(14, 3, 1990), 'Металлическая Лошадь');
  assert.equal(easternYear(15, 1, 1990), 'Земляная Змея');
  assert.equal(easternYear(10, 6, 1984), 'Деревянная Крыса');
  assert.equal(easternYear(10, 6, 1988), 'Земляной Дракон');
});

test('число судьбы, включая мастер-числа', () => {
  assert.equal(lifePathNumber(14, 3, 1990), 9);
  assert.equal(lifePathNumber(20, 9, 1980), 11);
});

test('разбор даты в разных форматах', () => {
  const expected = { day: 14, month: 3, year: 1990 };
  for (const s of ['14.03.1990', '14/03/1990', '14-3-1990', '1990-03-14', '14 марта 1990', '14 марта 1990 года']) {
    assert.deepEqual(parseBirthDate(s, NOW), expected, s);
  }
  for (const s of ['31.02.1990', '14.03.2099', 'вчера', '', '1.1.1800']) {
    assert.throws(() => parseBirthDate(s, NOW), InputError, s);
  }
});

test('разбор ФИО и места', () => {
  assert.deepEqual(parseFullName('иванова  мария петровна'), { full: 'Иванова Мария Петровна', firstName: 'Мария' });
  assert.deepEqual(parseFullName('Мария Иванова'), { full: 'Мария Иванова', firstName: 'Мария' });
  assert.equal(parseFullName('Анна-Мария Салтыкова-Щедрина').firstName, 'Анна-Мария');
  assert.throws(() => parseFullName('Мария'), InputError);
  assert.throws(() => parseFullName('Мария 123'), InputError);
  assert.equal(parseBirthPlace('  нижний   новгород '), 'Нижний новгород');
  assert.throws(() => parseBirthPlace('12'), InputError);
});

test('прогноз детерминирован и содержит все блоки', () => {
  const input = { name: 'Иванова Мария Петровна', birthDate: '14.03.1990', birthPlace: 'Казань' };
  const a = makeForecast(input, { now: NOW });
  const b = makeForecast(input, { now: NOW });
  assert.equal(a.text, b.text);
  assert.equal(a.data.zodiac, 'Рыбы');
  assert.equal(a.data.life_path_number, 9);
  assert.equal(a.data.birth_date, '14.03.1990');
  for (const part of ['Мария, ваш бесплатный прогноз', 'Знак зодиака: Рыбы', 'Число судьбы: 9', 'Личный год 2026', 'Место рождения: Казань', 'полном персональном разборе']) {
    assert.ok(a.text.includes(part), part);
  }
  assert.ok(!a.text.includes('undefined'));
  assert.ok(a.text.length < 4096, 'влезает в одно сообщение Telegram');
});

test('прогноз без undefined для всех дат года и всех чисел', () => {
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      for (const y of [1955, 1977, 1988, 1999, 2004]) {
        const r = makeForecast({ name: 'Петров Пётр', birthDate: `${d}.${m}.${y}`, birthPlace: 'Омск' }, { now: NOW });
        assert.ok(!r.text.includes('undefined'), `${d}.${m}.${y}`);
      }
    }
  }
});

test('вебхук: успешный ответ и ошибка ввода', async () => {
  const ok = await worker.fetch(new Request('https://x/forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fio: 'Смирнов Алексей Игоревич', dob: '02.08.1985', city: 'Самара' }),
  }), {});
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.zodiac, 'Лев');
  assert.ok(body.forecast.startsWith('🔮 Алексей'));

  const bad = await worker.fetch(new Request('https://x/forecast?name=Алексей&birth_date=02.08.1985&birth_place=Самара'), {});
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).error, 'bad_name');

  const locked = await worker.fetch(new Request('https://x/forecast?name=Смирнов+Алексей&birth_date=02.08.1985&birth_place=Самара'), { API_KEY: 's3cret' });
  assert.equal(locked.status, 401);
});
