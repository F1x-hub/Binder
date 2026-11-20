import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { marketFromCard, pickPrinting, tcgplayerProductId } from '@/lib/card-market';
import { clubKeysFrom, maskKey, validKeyText } from '@/lib/club-keys';
import type { CardV2 } from '@/lib/justtcg';

const NOW_MS = Date.UTC(2026, 10, 21);

/** Ответ GET /v2/cards в том виде, как его описывает https://justtcg.com/docs/api/cards-v2. */
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

const GASTLY: CardV2 = {
  id: '9b2e4d1a-0000',
  name: 'Gastly',
  number: '055/091',
  variants: [
    {
      type: 'raw',
      condition: 'Near Mint',
      printing: 'Normal',
      markets: [
        {
          region: 'NA',
          currency: 'USD',
          price: 0.09,
          price_status: 'current',
          periods: { '30d': { change_pct: -12.5 } },
          price_history: [
            { t: day('2026-11-20'), p: 0.09 },
            { t: day('2025-11-21'), p: 0.3 },
            { t: day('2026-05-01'), p: 0.12 },
          ],
        },
      ],
    },
    { type: 'raw', condition: 'Lightly Played', printing: 'Normal', markets: [{ region: 'NA', price: 0.07 }] },
    {
      type: 'raw',
      condition: 'Near Mint',
      printing: 'Reverse Holofoil',
      markets: [{ region: 'NA', price: null, price_status: 'expired', last_price: 0.24, price_history: [] }],
    },
    {
      type: 'graded',
      condition: null,
      printing: 'Normal',
      grading: { company: 'PSA', grade: 9, canonical: 'PSA 9' },
      markets: [{ region: 'NA', price: 18, price_status: 'current', last_sale_at: day('2026-10-02'), periods: { '90d': { sales_count: 3 } } }],
    },
    {
      type: 'graded',
      condition: null,
      printing: 'Normal',
      grading: { company: 'PSA', grade: 10, canonical: 'PSA 10' },
      markets: [{ region: 'NA', price: null, price_status: 'expired', last_price: 41, last_sale_at: day('2026-06-01') }],
    },
    {
      type: 'graded',
      condition: null,
      printing: 'Normal',
      grading: { company: 'CGC', grade: 10, canonical: 'CGC 10' },
      markets: [{ region: 'NA', price: null, price_status: 'unpriced' }],
    },
    {
      type: 'graded',
      condition: null,
      printing: 'Reverse Holofoil',
      grading: { company: 'PSA', grade: 10, canonical: 'PSA 10' },
      markets: [{ region: 'NA', price: 60, price_status: 'current' }],
    },
  ],
};

describe('рынок карты из JustTCG', () => {
  it('цена Near Mint своей печати, история по дням и изменение за 30 дней', () => {
    const market = marketFromCard(GASTLY, 'normal');
    expect(market.price).toBe(0.09);
    expect(market.change30).toBeCloseTo(-0.125);
    expect(market.history).toEqual([
      { day: '2025-11-21', usd: 0.3, eur: null },
      { day: '2026-05-01', usd: 0.12, eur: null },
      { day: '2026-11-20', usd: 0.09, eur: null },
    ]);
  });

  it('у реверса — цена реверса; устаревшая цена — последняя известная', () => {
    expect(marketFromCard(GASTLY, 'reverse').price).toBe(0.24);
  });

  it('грейды своей печати с ценой, PSA 10 выше PSA 9, без продаж — не показываются', () => {
    const graded = marketFromCard(GASTLY, 'normal').graded;
    expect(graded.map((slab) => [slab.label, slab.price, slab.current])).toEqual([
      ['PSA 10', 41, false],
      ['PSA 9', 18, true],
    ]);
    expect(graded[1]!.sales90).toBe(3);
    expect(graded[1]!.lastSale).toBe(day('2026-10-02') * 1000);
    expect(marketFromCard(GASTLY, 'reverse').graded.map((slab) => slab.price)).toEqual([60]);
  });

  it('печать: точная, а если у карты она одна — любая', () => {
    expect(pickPrinting(['Normal', 'Holofoil', 'Reverse Holofoil'], 'holo')).toBe('Holofoil');
    expect(pickPrinting(['Normal', 'Reverse Holofoil'], 'reverse')).toBe('Reverse Holofoil');
    expect(pickPrinting(['Holofoil'], 'normal')).toBe('Holofoil');
    expect(pickPrinting(['Normal', 'Reverse Holofoil'], 'holo')).toBeNull();
  });

  it('ID товара TCGplayer берётся из карточки TCGdex', () => {
    expect(tcgplayerProductId({ pricing: { tcgplayer: { unit: 'USD', normal: { productId: 534417, marketPrice: 0.09 } } } })).toBe('534417');
    expect(tcgplayerProductId({ pricing: { cardmarket: { trend: 0.06 } } })).toBeNull();
    expect(tcgplayerProductId(null)).toBeNull();
  });
});

describe('ключи клуба', () => {
  it('из документа берутся только похожие на ключи записи, не больше десяти', () => {
    const addedAt = Timestamp.fromMillis(NOW_MS);
    const items = [
      { key: 'tcg_abcdefgh', label: 'Основной', enabled: true, addedAt },
      { key: 'не ключ', label: 'x', enabled: true, addedAt },
      { key: 'tcg_second12', label: 'Запасной', enabled: false, addedAt },
      ...Array.from({ length: 12 }, (_, index) => ({ key: `tcg_extra${String(index).padStart(3, '0')}`, label: '', enabled: true, addedAt })),
    ];
    const keys = clubKeysFrom({ items });
    expect(keys).toHaveLength(10);
    expect(keys[0]).toMatchObject({ key: 'tcg_abcdefgh', label: 'Основной', enabled: true });
    expect(keys[1]).toMatchObject({ key: 'tcg_second12', enabled: false });
    expect(clubKeysFrom(undefined)).toEqual([]);
  });

  it('проверка вида ключа и маска для экрана', () => {
    expect(validKeyText('tcg_1a2b3c4d5e')).toBe(true);
    expect(validKeyText('tcg 1a2b')).toBe(false);
    expect(validKeyText('short')).toBe(false);
    expect(maskKey('tcg_1a2b3c4d5e')).toBe('tcg_••••4d5e');
  });
});
