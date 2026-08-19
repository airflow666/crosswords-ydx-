/**
 * Покупка товаров: оплата → начисление → «потребление».
 *
 * Порядок шагов здесь не случаен и важнее, чем кажется. Площадка считает
 * покупку выданной только после `consumePurchase`. Если начислить товар и
 * упасть до потребления — покупка вернётся в списке незавершённых, и мы выдадим
 * её второй раз. Если потребить до начисления и упасть — игрок останется без
 * товара и без следов оплаты.
 *
 * Поэтому: сначала НАЧИСЛЯЕМ (запись прогресса идёт с flush, то есть уже
 * улетела в облако), и только потом потребляем. Худший исход при сбое —
 * игрок получит товар дважды. Для казуальной игры это несравнимо лучше, чем
 * оплаченный и не выданный товар.
 *
 * На старте игры проверяем незавершённые покупки: так закрывается случай
 * «оплатил и закрыл вкладку до начисления».
 */

import { saves } from './saves.js';
import { productById } from './shop.js';

/**
 * Купить товар.
 * @returns {Promise<{ok:boolean, product:object|null}>}
 */
export async function buy(sdk, productId) {
  const product = productById(productId);
  if (!product || !sdk) return { ok: false, product: null };

  const { ok, token } = await sdk.purchase(productId);
  if (!ok) return { ok: false, product };

  saves.grantBoosters(product.grants);
  await sdk.consume(token);
  return { ok: true, product };
}

/**
 * Выдать всё оплаченное, но не выданное. Возвращает число выданных товаров,
 * чтобы экран мог показать сообщение — молча начислять покупку неправильно,
 * игрок должен понимать, откуда у него взялись подсказки.
 */
export async function restorePending(sdk) {
  if (!sdk) return 0;
  const pending = await sdk.pendingPurchases();
  let n = 0;
  for (const { id, token } of pending) {
    const product = productById(id);
    if (!product) continue;
    saves.grantBoosters(product.grants);
    await sdk.consume(token);
    n += 1;
  }
  return n;
}
