/** Простая локализация RU/EN. Язык берётся из SDK (ysdk.environment.i18n.lang). */

const DICT = {
  ru: {
    title: 'КРОССВОРДЫ',
    subtitle: 'Новый кроссворд каждый раз',
    play: 'ИГРАТЬ',
    continueGame: 'Продолжить',
    stats: 'Статистика',
    newCrossword: 'Новый кроссворд',
    across: 'По горизонтали',
    down: 'По вертикали',
    prevClue: 'Предыдущее',
    nextClue: 'Следующее',
    allClues: 'Все определения',
    erase: 'Стереть',
    hint: 'Подсказка',
    hintsLeft: 'Подсказок',
    noHintsLeft: 'Подсказки закончились',
    hintWatchAd: 'Посмотреть рекламу и открыть несколько букв?',
    watch: 'Смотреть',
    cancel: 'Отмена',
    back: 'Назад',
    menu: 'Меню',
    loading: 'Загрузка…',
    solved: 'Кроссворд разгадан!',
    yourTime: 'Ваше время',
    hintsUsed: 'Подсказок использовано',
    bestTime: 'Лучшее время',
    newBest: 'Новый рекорд!',
    solvedCount: 'Разгадано кроссвордов',
    dayStreak: 'Дней подряд',
    avgTime: 'Среднее время',
    noStats: 'Пока нет решённых кроссвордов',
    dayForms: ['день', 'дня', 'дней'],
    hintForms: ['подсказка', 'подсказки', 'подсказок'],
    crosswordForms: ['кроссворд', 'кроссворда', 'кроссвордов'],
    sound: 'Звук',
    theme: 'Тема',
    themeAuto: 'Авто',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    adUnavailable: 'Реклама сейчас недоступна',
  },
  en: {
    title: 'CROSSWORDS',
    subtitle: 'A fresh crossword every time',
    play: 'PLAY',
    continueGame: 'Continue',
    stats: 'Statistics',
    newCrossword: 'New crossword',
    across: 'Across',
    down: 'Down',
    prevClue: 'Previous',
    nextClue: 'Next',
    allClues: 'All clues',
    erase: 'Erase',
    hint: 'Hint',
    hintsLeft: 'Hints',
    noHintsLeft: 'No hints left',
    hintWatchAd: 'Watch an ad to reveal a few letters?',
    watch: 'Watch',
    cancel: 'Cancel',
    back: 'Back',
    menu: 'Menu',
    loading: 'Loading…',
    solved: 'Crossword solved!',
    yourTime: 'Your time',
    hintsUsed: 'Hints used',
    bestTime: 'Best time',
    newBest: 'New record!',
    solvedCount: 'Crosswords solved',
    dayStreak: 'Day streak',
    avgTime: 'Average time',
    noStats: 'No crosswords solved yet',
    dayForms: ['day', 'days'],
    hintForms: ['hint', 'hints'],
    crosswordForms: ['crossword', 'crosswords'],
    sound: 'Sound',
    theme: 'Theme',
    themeAuto: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    adUnavailable: 'Ads are unavailable right now',
  },
};

// Русский показываем всему русскоязычному каталогу Яндекса, не только lang=ru
const RU_LANGS = ['ru', 'be', 'kk', 'uk', 'uz'];

let currentLang = 'ru';

export function setLang(lang) {
  currentLang = RU_LANGS.includes(lang) ? 'ru' : 'en';
}

export function getLang() {
  return currentLang;
}

export function t(key) {
  return DICT[currentLang][key] ?? DICT.en[key] ?? key;
}

/**
 * Правильно склонённое слово для числа: день / дня / дней.
 * forms в словаре: [один, два-четыре, много] для ru; [one, many] для en.
 */
export function pluralWord(n, key) {
  const forms = DICT[currentLang][key] ?? DICT.en[key];
  if (currentLang === 'ru') {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}
