import { describe, expect, it } from 'vitest';
import { formatCardPrice, rarityLabel } from '@/lib/format';
import { priceDocId, priceFromCard, priceKey, utcDay } from '@/lib/prices';
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
      { catalog: 'en', setId: 'sv03', lang: 'en', count: 2, price: { u: 4.88, e: null } },
      { catalog: 'en', setId: 'sv03', lang: 'fr', count: 1, price: null },
      { catalog: 'en', setId: 'base1', lang: 'en', count: 1, price: { u: 1284, e: null } },
    ]);
    expect(totals).toEqual({ copies: 4, sets: 2, value: 1293.76, euro: 0 });
  });

  it('у японских карт только евро: они считаются отдельно, а их сеты — свои', () => {
    const totals = collectionTotals([
      { catalog: 'en', setId: 'sv03', lang: 'en', count: 1, price: { u: 2, e: 1.5 } },
      { catalog: 'ja', setId: 'SV2a', lang: 'ja', count: 3, price: { u: null, e: 0.2 } },
      { catalog: null, setId: 'MBG', lang: 'ja', count: 1, price: null },
    ]);
    expect(totals).toEqual({ copies: 5, sets: 3, value: 2, euro: 0.6 });
  });

  it('у японского каталога свой документ цен, а ключи карт не пересекаются с тайваньскими', () => {
    expect(priceDocId('en', 'sv03')).toBe('sv03');
    expect(priceDocId('ja', 'SV2a')).toBe('ja_SV2a');
    expect(priceDocId('zh-tw', 'SV2a')).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
    expect(priceKey('ja', 'SV2a-094')).not.toBe(priceKey('zh-tw', 'SV2a-094'));
    expect(priceKey('en', 'sv03-125')).toBe('sv03-125');
  });

  it('у японской карты TCGplayer пуст, цена берётся с Cardmarket', () => {
    const pricing = { cardmarket: { trend: 0.2, avg: 0.49 }, tcgplayer: undefined };
    expect(priceFromCard({ pricing, variants: { normal: true, reverse: true } })).toEqual({ u: null, e: 0.2 });
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
