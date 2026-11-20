import { describe, expect, it } from 'vitest';
import { formatCardPrice, rarityLabel } from '@/lib/format';
import { priceFromCard, utcDay } from '@/lib/prices';
import { cardImage, isPocketCard, setIdOf } from '@/lib/tcgdex';
import { collectionTotals, newestFirst } from '@/lib/useCardViews';
import { variantFor } from '@/scan/useScan';

describe('priceFromCard', () => {
  it('для голо-карты берёт цену holofoil, для обычной — normal', () => {
    const pricing = {
      tcgplayer: { normal: { marketPrice: 1.2 }, holofoil: { marketPrice: 4.88 } },
      cardmarket: { trend: 3.88, avg: 3.63 },
    };
    expect(priceFromCard({ pricing, variants: { holo: true, normal: false } })).toEqual({ u: 4.88, e: 3.88 });
    expect(priceFromCard({ pricing, variants: { holo: true, normal: true } })).toEqual({ u: 1.2, e: 3.88 });
  });

  it('если рыночной цены нет, берёт среднюю, а евро — из avg', () => {
    const pricing = { tcgplayer: { reverseHolofoil: { marketPrice: null, midPrice: 0.5 } }, cardmarket: { trend: 0, avg: 0.2 } };
    expect(priceFromCard({ pricing, variants: {} })).toEqual({ u: 0.5, e: 0.2 });
  });

  it('без цен возвращает пустоту, а не нули', () => {
    expect(priceFromCard({ pricing: undefined, variants: undefined })).toEqual({ u: null, e: null });
  });

  it('округляет до центов', () => {
    expect(priceFromCard({ pricing: { tcgplayer: { normal: { marketPrice: 0.12345 } } }, variants: {} }).u).toBe(0.12);
  });
});

describe('мелочи вокруг цен', () => {
  it('день по UTC', () => {
    expect(utcDay(new Date('2026-11-20T23:30:00-05:00'))).toBe('2026-11-21');
  });

  it('цена карты: доллары, иначе евро, иначе прочерк', () => {
    expect(formatCardPrice({ u: 24.8, e: 3 })).toBe('$24,80');
    expect(formatCardPrice({ u: null, e: 3.88 })).toBe('€3,88');
    expect(formatCardPrice(null)).toBe('—');
  });

  it('редкость с заглавных', () => {
    expect(rarityLabel('Double rare')).toBe('Double Rare');
    expect(rarityLabel(undefined)).toBeNull();
  });

  it('итоги альбома считают копии, сеты и стоимость по картам с ценой', () => {
    const totals = collectionTotals([
      { setId: 'sv03', count: 2, price: { u: 4.88, e: null } },
      { setId: 'sv03', count: 1, price: null },
      { setId: 'base1', count: 1, price: { u: 1284, e: null } },
    ]);
    expect(totals).toEqual({ copies: 4, sets: 2, value: 1293.76 });
  });

  it('новые карты сверху, а только что добавленные — самыми первыми', () => {
    const at = (ms: number) => ({ toMillis: () => ms }) as never;
    const sorted = newestFirst([{ addedAt: at(1), id: 'old' }, { addedAt: null, id: 'pending' }, { addedAt: at(5), id: 'new' }]);
    expect(sorted.map((card) => card.id)).toEqual(['pending', 'new', 'old']);
  });
});

describe('TCGdex', () => {
  it('отличает карты TCG Pocket', () => {
    expect(isPocketCard({ id: 'A1-036', localId: '036', name: 'Charizard ex' })).toBe(true);
    expect(isPocketCard({ id: 'P-A-001', localId: '001', name: 'Potion' })).toBe(true);
    expect(isPocketCard({ id: 'x', localId: '1', name: 'y', image: 'https://assets.tcgdex.net/en/tcgp/A1/036' })).toBe(true);
    expect(isPocketCard({ id: 'sv03-125', localId: '125', name: 'Charizard ex' })).toBe(false);
  });

  it('достаёт ID сета из ID карты', () => {
    expect(setIdOf({ id: 'sv03.5-006', localId: '006', name: '' })).toBe('sv03.5');
    expect(setIdOf({ id: '30th-c-012', localId: '012', name: '' })).toBe('30th-c');
  });

  it('собирает адрес картинки', () => {
    expect(cardImage('https://assets.tcgdex.net/en/sv/sv03/125', 'low')).toBe(
      'https://assets.tcgdex.net/en/sv/sv03/125/low.webp',
    );
    expect(cardImage(undefined, 'high')).toBeNull();
  });
});

describe('variantFor', () => {
  it('голо по фото и голо в справочнике — голо', () => {
    expect(variantFor({ holo: true }, { variants: { holo: true, normal: false } })).toBe('holo');
  });

  it('голо по фото, но у карты бывает только реверс — реверс', () => {
    expect(variantFor({ holo: true }, { variants: { holo: false, normal: true, reverse: true } })).toBe('reverse');
  });

  it('карта бывает только голо — голо, что бы ни показалось на фото', () => {
    expect(variantFor({ holo: false }, { variants: { normal: false, holo: true } })).toBe('holo');
  });

  it('по умолчанию обычная', () => {
    expect(variantFor({ holo: null }, undefined)).toBe('normal');
  });
});
