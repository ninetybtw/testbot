// Движок бесплатного прогноза: ФИО + дата рождения + место рождения → текст прогноза.
// Без зависимостей: работает в Cloudflare Worker, в браузере и в Node.
// Один и тот же ввод всегда даёт один и тот же прогноз (в пределах одного месяца).

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

// ---------- Знаки зодиака ----------

// [день начала, месяц начала, ...]; знак действует с этой даты до начала следующего.
const SIGNS = [
  { from: [20, 1], name: 'Водолей', icon: '♒', element: 'Воздух', planet: 'Уран',
    trait: 'Вы мыслите на шаг впереди других и цените свободу больше, чем одобрение.' },
  { from: [19, 2], name: 'Рыбы', icon: '♓', element: 'Вода', planet: 'Нептун',
    trait: 'У вас сильная интуиция: вы часто чувствуете ответ раньше, чем можете его объяснить.' },
  { from: [21, 3], name: 'Овен', icon: '♈', element: 'Огонь', planet: 'Марс',
    trait: 'Вы человек действия: быстро загораетесь идеей и первым делаете шаг.' },
  { from: [20, 4], name: 'Телец', icon: '♉', element: 'Земля', planet: 'Венера',
    trait: 'Вы строите надёжно и надолго, а ваше упорство со временем превращается в результат.' },
  { from: [21, 5], name: 'Близнецы', icon: '♊', element: 'Воздух', planet: 'Меркурий',
    trait: 'Ваша сила — в общении и гибкости ума: вы легко находите подход к людям.' },
  { from: [21, 6], name: 'Рак', icon: '♋', element: 'Вода', planet: 'Луна',
    trait: 'Вы глубоко чувствуете людей и умеете создавать вокруг себя ощущение дома.' },
  { from: [23, 7], name: 'Лев', icon: '♌', element: 'Огонь', planet: 'Солнце',
    trait: 'Вы притягиваете внимание и вдохновляете других, когда горите своим делом.' },
  { from: [23, 8], name: 'Дева', icon: '♍', element: 'Земля', planet: 'Меркурий',
    trait: 'Вы замечаете детали, которые другие упускают, и умеете навести порядок в хаосе.' },
  { from: [23, 9], name: 'Весы', icon: '♎', element: 'Воздух', planet: 'Венера',
    trait: 'Вы тонко чувствуете гармонию и умеете находить баланс там, где другие спорят.' },
  { from: [23, 10], name: 'Скорпион', icon: '♏', element: 'Вода', planet: 'Плутон',
    trait: 'В вас скрыта огромная внутренняя сила: вы проходите через кризисы и выходите сильнее.' },
  { from: [22, 11], name: 'Стрелец', icon: '♐', element: 'Огонь', planet: 'Юпитер',
    trait: 'Вас ведёт жажда смысла и новых горизонтов, а оптимизм открывает вам двери.' },
  { from: [22, 12], name: 'Козерог', icon: '♑', element: 'Земля', planet: 'Сатурн',
    trait: 'Вы умеете ставить долгие цели и спокойно, шаг за шагом, их достигать.' },
];

const ELEMENT_PERIOD = {
  'Огонь': 'Звёзды подталкивают вас к смелым решениям: то, что вы давно откладывали, сейчас получится легче, чем кажется.',
  'Земля': 'Период благоприятен для финансовых и бытовых вопросов: вложенные усилия начнут давать ощутимый результат.',
  'Воздух': 'Важную роль сыграют люди и разговоры: случайная встреча или переписка может открыть новую возможность.',
  'Вода': 'Прислушивайтесь к интуиции и снам: внутренний голос подскажет верный ответ в запутанной ситуации.',
};

export function zodiacSign(day, month) {
  // Перебираем с конца: первый знак, чья дата начала уже наступила.
  for (let i = SIGNS.length - 1; i >= 0; i--) {
    const [d, m] = SIGNS[i].from;
    if (month > m || (month === m && day >= d)) return SIGNS[i];
  }
  return SIGNS[SIGNS.length - 1]; // 1–19 января — Козерог
}

// ---------- Восточный гороскоп ----------

const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
// Прилагательные для стихий; род зависит от животного.
const EAST_ELEMENTS = [
  { m: 'Металлический', f: 'Металлическая' }, { m: 'Металлический', f: 'Металлическая' },
  { m: 'Водяной', f: 'Водяная' }, { m: 'Водяной', f: 'Водяная' },
  { m: 'Деревянный', f: 'Деревянная' }, { m: 'Деревянный', f: 'Деревянная' },
  { m: 'Огненный', f: 'Огненная' }, { m: 'Огненный', f: 'Огненная' },
  { m: 'Земляной', f: 'Земляная' }, { m: 'Земляной', f: 'Земляная' },
];
const FEMININE_ANIMALS = new Set(['Крыса', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Собака', 'Свинья']);

export function easternYear(day, month, year) {
  // Восточный год упрощённо начинается 4 февраля (Личунь).
  const y = month < 2 || (month === 2 && day < 4) ? year - 1 : year;
  const animal = ANIMALS[(((y - 4) % 12) + 12) % 12];
  const el = EAST_ELEMENTS[((y % 10) + 10) % 10];
  return `${FEMININE_ANIMALS.has(animal) ? el.f : el.m} ${animal}`;
}

// ---------- Нумерология ----------

// Пифагорова таблица: буква → цифра 1–9.
const LETTER_VALUES = (() => {
  const map = {};
  'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.split('').forEach((ch, i) => { map[ch] = (i % 9) + 1; });
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((ch, i) => { map[ch] = (i % 9) + 1; });
  return map;
})();
const VOWELS = new Set('аеёиоуыэюяaeiouy'.split(''));

export function reduce(n, keepMaster = true) {
  while (n > 9 && !(keepMaster && (n === 11 || n === 22 || n === 33))) {
    n = String(n).split('').reduce((s, d) => s + Number(d), 0);
  }
  return n;
}

function lettersSum(text, onlyVowels = false) {
  let sum = 0;
  for (const ch of text.toLowerCase()) {
    if (!(ch in LETTER_VALUES)) continue;
    if (onlyVowels && !VOWELS.has(ch)) continue;
    sum += LETTER_VALUES[ch];
  }
  return sum;
}

function digitsSum(n) {
  return String(n).split('').reduce((s, d) => s + Number(d), 0);
}

export function lifePathNumber(day, month, year) {
  return reduce(digitsSum(day) + digitsSum(month) + digitsSum(year));
}

const LIFE_PATH = {
  1: 'Число судьбы 1 — число лидера. Ваш путь — вести за собой и начинать новое, а не ждать разрешения.',
  2: 'Число судьбы 2 — число дипломата. Ваш дар — объединять людей и чувствовать, что нужно другому.',
  3: 'Число судьбы 3 — число творца. Вам дано вдохновлять словом и идеями, а радость — ваш главный ресурс.',
  4: 'Число судьбы 4 — число строителя. Вы создаёте прочный фундамент, на который опираются другие.',
  5: 'Число судьбы 5 — число свободы. Перемены, путешествия и новый опыт для вас — источник силы.',
  6: 'Число судьбы 6 — число заботы. Семья, близкие и красота вокруг — то, ради чего вы раскрываетесь.',
  7: 'Число судьбы 7 — число мудреца. Вам дано видеть суть вещей и находить ответы в тишине.',
  8: 'Число судьбы 8 — число силы и денег. У вас врождённый талант управлять ресурсами и людьми.',
  9: 'Число судьбы 9 — число мудрого сердца. Вы пришли, чтобы помогать и отдавать, и это возвращается к вам сторицей.',
  11: 'Число судьбы 11 — мастер-число интуиции. Вы тонко чувствуете мир и способны вдохновлять других своим примером.',
  22: 'Число судьбы 22 — мастер-число созидателя. Вам по силам большие проекты, которые меняют жизнь многих людей.',
  33: 'Число судьбы 33 — мастер-число учителя. Ваше призвание — исцелять и наставлять, делясь своим светом.',
};

const NAME_NUMBER = {
  1: 'в нём звучит решительность и стремление быть первым',
  2: 'в нём звучат мягкость и умение договариваться',
  3: 'в нём звучат лёгкость, обаяние и творческая искра',
  4: 'в нём звучат надёжность и практичность',
  5: 'в нём звучат любопытство и любовь к переменам',
  6: 'в нём звучат теплота и ответственность за близких',
  7: 'в нём звучат глубина и тяга к знаниям',
  8: 'в нём звучат амбиции и деловая хватка',
  9: 'в нём звучат щедрость и широта души',
  11: 'в нём звучит особая, почти пророческая интуиция',
  22: 'в нём звучит масштаб и сила воплощения',
  33: 'в нём звучит сострадание и дар наставника',
};

const PERSONAL_YEAR = {
  1: 'Для вас сейчас идёт год новых начал. Это лучшее время, чтобы запустить то, о чём вы давно мечтали: посеянное сейчас будет расти следующие 9 лет.',
  2: 'Сейчас у вас год партнёрства и терпения. Важнее всего — отношения и союзы; не торопите события, нужные люди уже на подходе.',
  3: 'Сейчас у вас год самовыражения. Вас будут замечать: говорите, творите, показывайте себя — удача на стороне смелых.',
  4: 'Сейчас у вас год фундамента. Время навести порядок в делах, финансах и здоровье — это окупится с лихвой.',
  5: 'Сейчас у вас год перемен. Возможны переезд, новая работа или резкий поворот — не сопротивляйтесь, он ведёт к лучшему.',
  6: 'Сейчас у вас год семьи и любви. На первый план выходят близкие, дом и отношения; возможны важные решения в личной жизни.',
  7: 'Сейчас у вас год внутреннего поиска. Хорошее время для учёбы, отдыха и переосмысления: ответы придут изнутри.',
  8: 'Сейчас у вас год денег и результатов. Усилия прошлых лет конвертируются в доход и признание — просите больше, чем привыкли.',
  9: 'Сейчас у вас год завершений. Отпустите то, что отжило своё: освободившееся место скоро займёт новое и лучшее.',
};

const PLACE_NUMBER = {
  1: 'Энергия места рождения даёт вам самостоятельность: вы способны многого добиться без чужой помощи.',
  2: 'Энергия места рождения даёт вам чуткость к людям: рядом с вами другим становится спокойнее.',
  3: 'Энергия места рождения даёт вам творческую жилку и лёгкость в общении.',
  4: 'Энергия места рождения даёт вам корни и устойчивость: в трудный момент вы не теряете почву под ногами.',
  5: 'Энергия места рождения зовёт вас в дорогу: смена обстановки всегда приносит вам удачу.',
  6: 'Энергия места рождения связывает вас с родом: опора семьи — ваш скрытый ресурс.',
  7: 'Энергия места рождения дарит вам интуицию и любовь к уединению, в котором рождаются лучшие идеи.',
  8: 'Энергия места рождения усиливает материальную удачу: вам проще, чем другим, притягивать деньги.',
  9: 'Энергия места рождения даёт вам широту взглядов: вы легко находите общий язык с разными людьми.',
};

const ADVICE = [
  'В ближайшие дни запишите три желания на бумаге и перечитайте их в полнолуние — так вы направите энергию на их исполнение.',
  'Не принимайте важных решений на эмоциях в первой половине дня: лучшие идеи придут к вам вечером.',
  'Обратите внимание на повторяющиеся числа на часах и номерах — Вселенная подаёт вам знак, что вы на верном пути.',
  'Отдайте старую вещь, которая давно лежит без дела: освобождая пространство, вы открываете дорогу новому.',
  'Позвоните человеку, о котором вы недавно вспоминали: этот разговор окажется важнее, чем кажется.',
  'Начните утро с пяти минут тишины: в эти минуты интуиция подскажет вам главный шаг дня.',
  'Не бойтесь попросить о помощи: именно сейчас поддержка придёт оттуда, откуда вы не ждёте.',
  'Наденьте что-то цвета вашей стихии в важный день — это усилит вашу природную энергию.',
];

const ELEMENT_COLOR = { 'Огонь': 'красного или золотого', 'Земля': 'зелёного или коричневого', 'Воздух': 'голубого или белого', 'Вода': 'синего или серебристого' };

// ---------- Разбор ввода ----------

export class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MONTH_WORDS = {
  'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'мая': 5, 'май': 5, 'июн': 6, 'июл': 7,
  'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12,
};

export function parseBirthDate(input, now = new Date()) {
  const text = String(input ?? '').trim().toLowerCase();
  let day, month, year, m;
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [year, month, day] = [m[1], m[2], m[3]].map(Number);
  } else if ((m = text.match(/^(\d{1,2})[.\/\-\s](\d{1,2})[.\/\-\s](\d{4})$/))) {
    [day, month, year] = [m[1], m[2], m[3]].map(Number);
  } else if ((m = text.match(/^(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})(?:\s*г(?:ода|\.)?)?$/))) {
    day = Number(m[1]);
    year = Number(m[3]);
    month = MONTH_WORDS[m[2].slice(0, 3)];
  }
  if (!day || !month || !year) {
    throw new InputError('bad_date', 'Не получилось распознать дату. Напишите её в формате ДД.ММ.ГГГГ, например 14.03.1990.');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new InputError('bad_date', 'Такой даты не существует. Проверьте день и месяц, например 14.03.1990.');
  }
  if (year < 1900 || date > now) {
    throw new InputError('bad_date', 'Похоже, в дате опечатка. Напишите настоящую дату рождения, например 14.03.1990.');
  }
  return { day, month, year };
}

// «анна-мария» → «Анна-Мария»
const capitalize = (w) => w.toLowerCase().replace(/(^|-)([a-zа-яё])/g, (_, sep, ch) => sep + ch.toUpperCase());

const PATRONYMIC = /(вич|вна|ична|инична|ич|оглы|кызы)$/i;
const NAME_WORD = /^[a-zа-яё]+(?:[-'][a-zа-яё]+)*$/i;

export function parseFullName(input) {
  const words = String(input ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5 || !words.every((w) => NAME_WORD.test(w))) {
    throw new InputError('bad_name', 'Напишите, пожалуйста, полное имя: фамилию, имя и отчество (если есть), например «Иванова Мария Петровна».');
  }
  const pretty = words.map(capitalize);
  // «Иванова Мария Петровна» → Мария; «Мария Иванова» → Мария.
  const firstName = pretty.length >= 3 && PATRONYMIC.test(pretty[2]) ? pretty[1] : pretty[0];
  return { full: pretty.join(' '), firstName };
}

export function parseBirthPlace(input) {
  const place = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (place.length < 2 || place.length > 120 || lettersSum(place) === 0) {
    throw new InputError('bad_place', 'Напишите город или населённый пункт, где вы родились, например «Казань».');
  }
  return place.charAt(0).toUpperCase() + place.slice(1);
}

// ---------- Сборка прогноза ----------

function hash(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function periodLabel(now) {
  const start = now.getUTCMonth();
  const end = (start + 2) % 12;
  const endYear = now.getUTCFullYear() + (start + 2 > 11 ? 1 : 0);
  return `${MONTHS_NOM[start]} – ${MONTHS_NOM[end]} ${endYear}`;
}

export const DEFAULT_UPSELL = 'Это короткая версия. В полном персональном разборе — прогноз на 12 месяцев по месяцам, любовь и совместимость, деньги и предназначение, а также благоприятные даты для важных решений. Напишите «Хочу полный разбор», и я расскажу, как его получить.';

/**
 * @param {{name: string, birthDate: string, birthPlace: string, firstName?: string}} input
 * @param {{now?: Date, upsell?: string}} [options]
 */
export function makeForecast(input, options = {}) {
  const now = options.now ?? new Date();
  const name = parseFullName(input.name);
  if (input.firstName && NAME_WORD.test(String(input.firstName).trim())) {
    name.firstName = capitalize(String(input.firstName).trim());
  }
  const date = parseBirthDate(input.birthDate, now);
  const place = parseBirthPlace(input.birthPlace);

  const sign = zodiacSign(date.day, date.month);
  const east = easternYear(date.day, date.month, date.year);
  const lifePath = lifePathNumber(date.day, date.month, date.year);
  const nameNumber = reduce(lettersSum(name.full));
  const soulNumber = reduce(lettersSum(name.full, true));
  const currentYear = now.getUTCFullYear();
  const personalYear = reduce(digitsSum(date.day) + digitsSum(date.month) + digitsSum(currentYear), false);
  const placeNumber = reduce(lettersSum(place), false);

  const seed = hash(`${name.full}|${date.day}.${date.month}.${date.year}|${place}|${currentYear}-${now.getUTCMonth()}`);
  let advice = ADVICE[seed % ADVICE.length];
  if (advice.includes('цвета вашей стихии')) {
    advice = advice.replace('цвета вашей стихии', `${ELEMENT_COLOR[sign.element]} цвета (цвета вашей стихии — ${sign.element})`);
  }
  const upsell = options.upsell ?? DEFAULT_UPSELL;

  // Те же блоки, что и в тексте, — для карточек в Mini App.
  const sections = {
    title: `${name.firstName}, ваш бесплатный прогноз готов`,
    sign: { name: sign.name, glyph: sign.icon, element: sign.element, planet: sign.planet },
    eastern: east,
    numbers: [
      { key: 'life_path', label: 'Число судьбы', value: lifePath },
      { key: 'name', label: 'Число имени', value: nameNumber },
      { key: 'personal_year', label: `Личный год ${currentYear}`, value: personalYear },
      { key: 'place', label: 'Число места', value: placeNumber },
    ],
    character: `${sign.trait} ${LIFE_PATH[lifePath]} Ваше имя несёт вибрацию числа ${nameNumber}: ${NAME_NUMBER[nameNumber]}.`,
    period: { label: periodLabel(now), text: `${PERSONAL_YEAR[personalYear]} ${ELEMENT_PERIOD[sign.element]}` },
    place: { name: place, text: `Число места — ${placeNumber}. ${PLACE_NUMBER[placeNumber]}` },
    advice,
    upsell,
  };

  const text = [
    `🔮 ${sections.title}`,
    '',
    `${sign.icon} Знак зодиака: ${sign.name} (стихия ${sign.element}, планета ${sign.planet})`,
    `🐉 Восточный гороскоп: ${east}`,
    `🔢 Число судьбы: ${lifePath} · Число имени: ${nameNumber} · Личный год ${currentYear}: ${personalYear}`,
    '',
    '✨ Ваш характер',
    sections.character,
    '',
    `🌙 Ближайшие 3 месяца (${sections.period.label})`,
    sections.period.text,
    '',
    `📍 Место рождения: ${place}`,
    sections.place.text,
    '',
    '💫 Совет на ближайшие дни',
    advice,
    '',
    '—',
    upsell,
  ].join('\n');

  return {
    text,
    sections,
    data: {
      full_name: name.full,
      first_name: name.firstName,
      birth_date: `${String(date.day).padStart(2, '0')}.${String(date.month).padStart(2, '0')}.${date.year}`,
      birth_date_human: `${date.day} ${MONTHS_GEN[date.month - 1]} ${date.year}`,
      birth_place: place,
      zodiac: sign.name,
      element: sign.element,
      eastern_year: east,
      life_path_number: lifePath,
      name_number: nameNumber,
      soul_number: soulNumber,
      personal_year: personalYear,
      place_number: placeNumber,
    },
  };
}
