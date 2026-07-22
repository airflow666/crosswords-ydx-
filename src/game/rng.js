/**
 * Сеедируемый генератор псевдослучайных чисел (mulberry32).
 *
 * Один и тот же seed всегда даёт одну и ту же последовательность — это
 * обеспечивает воспроизводимость кроссворда (возобновление партии после
 * перезагрузки страницы) при полной уникальности между разными seed'ами.
 * Именно на этом строится фишка «уникальный кроссворд у каждого игрока».
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Обёртка с удобными методами поверх функции-источника [0,1). */
export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  /** Число [0, 1). */
  next() {
    return this._next();
  }

  /** Целое [0, n). */
  int(n) {
    return Math.floor(this._next() * n);
  }

  /** Случайный элемент массива. */
  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** Тасование Фишера–Йетса на месте (детерминированное для seed). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Сгенерировать seed для новой уникальной партии. */
export function newSeed() {
  return (Math.floor(Date.now() % 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
