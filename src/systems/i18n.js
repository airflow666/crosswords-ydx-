/**
 * Локализация. Игра русскоязычная (словарь кроссвордов — русские слова), поэтому
 * интерфейс всегда на русском. От английской версии отказались осознанно.
 */

const DICT = {
  title: 'КРОССВОРДЫ',
  subtitle: 'Новый кроссворд каждый раз',
  play: 'ИГРАТЬ',
  newGame: 'Новая игра',
  continueGame: 'Продолжить',
  dropCurrentAsk: 'Начатый кроссворд не сохранится. Начать новый?',
  dropCurrentYes: 'Начать новый',
  dropCurrentNo: 'Вернуться к партии',
  stats: 'Статистика',
  newCrossword: 'Новый кроссворд',
  across: 'По горизонтали',
  down: 'По вертикали',
  prevClue: 'Предыдущее',
  nextClue: 'Следующее',
  allClues: 'Все определения',
  erase: 'Стереть',
  progress: 'Отгадано слов',
  notMatching: 'не сходится',
  cellRevealed: 'Эта буква уже открыта',
  nothingToReveal: 'Открывать нечего',
  hint: 'Подсказка',
  hintFree: 'Первая подсказка — бесплатно',
  hintNeedsAd: 'Откроет буквы за просмотр рекламы',
  noHintsLeft: 'Подсказки закончились',
  hintWatchAd: 'Посмотреть рекламу и открыть несколько букв в текущем слове?',
  watch: 'Смотреть',
  cancel: 'Отмена',
  back: 'Назад',
  menu: 'Меню',
  exitToMenu: 'Выйти в меню',
  wordSolved: 'Слово отгадано',
  loading: 'Загрузка…',
  solved: 'Кроссворд разгадан!',
  yourTime: 'Ваше время',
  wordsInGrid: 'Слов в кроссворде',
  hintsUsed: 'Подсказок использовано',
  solvedCount: 'Разгадано кроссвордов',
  wordsSolved: 'Отгадано слов',
  noHintsSolved: 'Пройдено без подсказок',
  dayStreak: 'Дней подряд',
  noStats: 'Пока нет решённых кроссвордов',
  dayForms: ['день', 'дня', 'дней'],
  crosswordForms: ['кроссворд', 'кроссворда', 'кроссвордов'],
  sound: 'Звук',
  theme: 'Тема',
  adUnavailable: 'Реклама сейчас недоступна',
};

/** Оставлено для совместимости с вызовами; интерфейс всегда русский. */
export function setLang() {}

export function t(key) {
  return DICT[key] ?? key;
}

/** Правильно склонённое слово для числа: день / дня / дней. */
export function pluralWord(n, key) {
  const forms = DICT[key];
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}
