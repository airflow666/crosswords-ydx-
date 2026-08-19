/**
 * Магазин: остаток подсказок и покупка наборов.
 *
 * Цены берём из каталога консоли, а не из кода: их там можно менять без
 * пересборки игры, и они уже приходят в валюте и оформлении площадки.
 * Значения из `shop.js` — только запасной вариант на время загрузки каталога
 * и на случай, если платежи недоступны (гость, отключённый модуль, нет сети).
 */

import { el, toast } from '../ui.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { BOOSTERS, BOOSTER_IDS, PRODUCTS } from '../systems/shop.js';
import { buy } from '../systems/purchases.js';

export function renderShop(ctx) {
  let alive = true;

  const invRow = el('div.booster-row');
  const list = el('div.shop-list');

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('menu'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('shop')),
    ]),
    el('section.shop-inv', {}, [
      el('h3.shop-sub', {}, t('shopBoosters')),
      invRow,
    ]),
    list,
  ]);

  ctx.mount(screen);
  screen._cleanup = () => { alive = false; };

  drawInventory();
  drawProducts(new Map());
  loadPrices();

  function drawInventory() {
    invRow.replaceChildren(...BOOSTER_IDS.map((id) => {
      const b = BOOSTERS[id];
      return el('div.booster-cell', {}, [
        el('span.booster-ico', {}, b.icon),
        el('span.booster-name', {}, b.title),
        el('span.booster-count', {}, String(saves.countOf(id))),
      ]);
    }));
  }

  function drawProducts(priceById) {
    list.replaceChildren(...PRODUCTS.map((p) => {
      const price = priceById.get(p.id);
      const btn = el('button.btn.primary.buy-btn', { onclick: () => onBuy(p, btn) },
        price || `${p.priceHint} YAN`);
      return el('div.shop-item' + (p.best ? '.best' : ''), {}, [
        p.best ? el('span.shop-badge', {}, t('shopBest')) : null,
        el('span.shop-ico', {}, p.icon),
        el('div.shop-text', {}, [
          el('b', {}, p.title),
          el('span', {}, p.desc),
        ]),
        btn,
      ]);
    }));
  }

  /** Цены из каталога площадки — подставляем, как только пришли. */
  async function loadPrices() {
    const catalog = await ctx.sdk.getCatalog();
    if (!alive || !catalog.length) return;
    const map = new Map(catalog.map((c) => [c.id, c.price]));
    drawProducts(map);
  }

  async function onBuy(product, btn) {
    btn.disabled = true;
    const { ok } = await buy(ctx.sdk, product.id);
    if (!alive) return;
    btn.disabled = false;
    if (!ok) { toast(t('shopUnavailable')); return; }
    toast(t('shopThanks'));
    drawInventory();
  }
}
