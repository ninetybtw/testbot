// Прогноз в терминале: npm run demo -- "Иванова Мария Петровна" 14.03.1990 Казань
import { makeForecast, InputError } from '../src/forecast.js';

const [name = 'Иванова Мария Петровна', birthDate = '14.03.1990', ...place] = process.argv.slice(2);
try {
  const { text, data } = makeForecast({ name, birthDate, birthPlace: place.join(' ') || 'Казань' });
  console.log(text);
  console.log('\nПоля для карточки CRM:', data);
} catch (e) {
  if (!(e instanceof InputError)) throw e;
  console.error(e.message);
  process.exit(1);
}
