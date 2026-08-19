/**
 * Даты, серия дней и календарь кроссворда дня.
 *
 * Ключевое решение: серия НЕ хранится счётчиком. Хранится множество дней, в
 * которые игрок решил хотя бы один кроссворд, а длина серии каждый раз
 * считается по нему. Так восстановление пропущенного дня за рекламу работает
 * само собой — достаточно добавить день в множество, — и серия не может
 * разъехаться с календарём, который игрок видит своими глазами.
 *
 * Дни хранятся числами (сколько суток прошло с 1 января 1970 года по местному
 * времени): в сохранении это в три раза компактнее строк «2026-08-17», а
 * арифметика «вчера — это минус один» становится тривиальной.
 *
 * Всё считается по МЕСТНОМУ времени игрока. Кроссворд дня привязан к местной
 * дате намеренно: игрок живёт в своём часовом поясе, и «новый день» должен
 * наступать для него в полночь, а не в полночь по Москве.
 */

const MS_PER_DAY = 86400000;

/** Номер дня для даты (по местному времени). */
export function dayNumber(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(d.getTime() / MS_PER_DAY);
}

/** Обратное преобразование: номер дня → Date (полночь местного времени). */
export function dayToDate(n) {
  const d = new Date(n * MS_PER_DAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function today() {
  return dayNumber();
}

/** Ключ вида «2026-08-17» — им сеедируется кроссворд дня и тема дня. */
export function dateKey(n = today()) {
  const d = dayToDate(n);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Длина текущей серии по множеству решённых дней.
 *
 * Отсчёт ведётся от сегодня, если сегодня уже решён, иначе от вчера: серия не
 * считается прерванной, пока сегодняшний день ещё не кончился. Именно поэтому
 * игрок, зашедший утром, видит вчерашние семь дней, а не ноль.
 */
export function streakLength(daysSet, now = today()) {
  let anchor;
  if (daysSet.has(now)) anchor = now;
  else if (daysSet.has(now - 1)) anchor = now - 1;
  else return 0;
  let n = 0;
  while (daysSet.has(anchor - n)) n++;
  return n;
}

/** Самая длинная серия за всё время — для достижений и статистики. */
export function bestStreak(daysSet) {
  const sorted = [...daysSet].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/**
 * Дни, которые имеет смысл восстанавливать: пропуски внутри уже начатой истории.
 *
 * Восстанавливать «дырку» осмысленно только там, где она реально рвёт серию, —
 * между решёнными днями или прямо перед текущей серией. Предлагать выкупить
 * день из позапрошлого года, за которым ничего нет, бессмысленно: серию это не
 * удлинит, а игрок потратит просмотр рекламы впустую.
 *
 * Возвращает номера дней, отсортированные от свежих к старым.
 */
export function restorableDays(daysSet, now = today(), lookback = 60) {
  if (!daysSet.size) return [];
  const out = [];
  const oldest = Math.min(...daysSet);
  const from = Math.max(oldest, now - lookback);
  for (let d = now - 1; d >= from; d--) {
    if (daysSet.has(d)) continue;
    // день полезен, если он примыкает к решённому дню хотя бы с одной стороны:
    // только такой пропуск можно закрыть и склеить две части серии
    if (daysSet.has(d - 1) || daysSet.has(d + 1)) out.push(d);
  }
  return out;
}

/**
 * Сетка календаря на месяц: недели по семь дней, неделя начинается с
 * понедельника. Пустые клетки — null, чтобы разметка не считала отступы сама.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay(): 0 — воскресенье. Приводим к «понедельник = 0».
  const lead = (first.getDay() + 6) % 7;
  const cells = new Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(dayNumber(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
