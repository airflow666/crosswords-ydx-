/**
 * Тесты правил показа рекламы. Запуск: часть `npm test`.
 *
 * Проверяем ровно то, за что возвращают с модерации и что не поймать глазами:
 * полноэкранный ролик не показывается на старте, не чаще раза в минуту, и
 * кулдаун отсчитывается от ФАКТИЧЕСКОГО показа, а не от попытки. Последнее
 * важно: если считать от попытки, одна неудача (нет сети, нет заполнения)
 * съедает окно, и следующий честный показ пропускается.
 *
 * Время подменяем через Date.now — ждать реальные минуты в тестах нельзя.
 */

import { ads } from '../src/systems/ads.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}

const realNow = Date.now;
let clock = 1_000_000;
Date.now = () => clock;
const advance = (sec) => { clock += sec * 1000; };

/** Мок SDK: считает показы и отдаёт заданный исход. */
function makeSdk(wasShown = true) {
  return {
    calls: [],
    wasShown,
    gameplayStart() { this.calls.push('start'); },
    gameplayStop() { this.calls.push('stop'); },
    showInterstitial() { this.calls.push('interstitial'); return Promise.resolve({ wasShown: this.wasShown }); },
    showRewarded() { this.calls.push('rewarded'); return Promise.resolve({ rewarded: true }); },
  };
}

console.log('Реклама: первые партии без роликов…');
{
  const sdk = makeSdk();
  ads.init(sdk);
  advance(600);                       // кулдаун заведомо прошёл
  const first = await ads.betweenLevels();
  const second = await ads.betweenLevels();
  check(first === false, 'после первой партии ролика быть не должно');
  check(second === false, 'после второй партии ролика быть не должно');
  check(!sdk.calls.includes('interstitial'), 'SDK не должен вызываться в льготных партиях');
}

console.log('Реклама: кулдаун между показами…');
{
  const sdk = makeSdk();
  ads.init(sdk);
  advance(600);
  await ads.betweenLevels();          // 1 — льготная
  await ads.betweenLevels();          // 2 — льготная
  const third = await ads.betweenLevels();
  check(third === true, 'третья партия должна дать показ');

  const immediately = await ads.betweenLevels();
  check(immediately === false, 'сразу после показа второго ролика быть не должно');

  advance(30);
  check((await ads.betweenLevels()) === false, 'через 30 секунд показывать ещё рано');

  advance(40);                        // суммарно 70 секунд
  check((await ads.betweenLevels()) === true, 'через 70 секунд показ снова разрешён');
}

console.log('Реклама: неудачная попытка не съедает окно…');
{
  const sdk = makeSdk(false);         // площадка ролик не отдала
  ads.init(sdk);
  advance(600);
  await ads.betweenLevels();
  await ads.betweenLevels();
  const failed = await ads.betweenLevels();
  check(failed === false, 'при отказе площадки показа нет');

  sdk.wasShown = true;
  const retry = await ads.betweenLevels();
  check(retry === true, 'после неудачи следующая попытка должна пройти сразу, а не через минуту');
}

console.log('Реклама: rewarded глушит геймплей и возвращает его…');
{
  const sdk = makeSdk();
  ads.init(sdk);
  const rewarded = await ads.showRewarded();
  check(rewarded === true, 'rewarded должен вернуть true при досмотре');
  check(sdk.calls.join(',') === 'stop,rewarded,start',
    `порядок вызовов должен быть stop → rewarded → start, получили ${sdk.calls.join(',')}`);

  // Полноэкранный ролик встык за rewarded — верный способ разозлить игрока.
  ads.levelsFinished = 99;
  check((await ads.betweenLevels()) === false, 'сразу после rewarded interstitial показывать нельзя');
}

Date.now = realNow;

if (failures === 0) { console.log('\n✓ Тесты рекламы пройдены'); }
else { console.error(`\n✗ Провалено проверок: ${failures}`); process.exit(1); }
