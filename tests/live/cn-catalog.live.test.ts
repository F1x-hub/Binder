import { beforeAll, describe, expect, it } from 'vitest';
import { findCandidates } from '@/lib/catalog';
import { buildCnIndex, CN_DATASET_URL, cnCatalog, searchCnIndex, setCnIndexForTests, type CnIndex, type RawCnDataset } from '@/lib/cn-catalog';
import { refreshCnPrices } from '@/lib/cn-prices';
import { decide, type DetectedCard } from '@/lib/matching';
import { fetchPikaqianSet, matchPikaqian } from '@/lib/pikaqian';

// Китайский каталог для КНР на настоящем наборе с GitHub и цены PikaQian (нужен интернет):
// набор весит 28 МБ (4 МБ по сети), страница сета PikaQian — до 1 МБ.

let index: CnIndex;

beforeAll(async () => {
  const raw = (await (await fetch(CN_DATASET_URL)).json()) as RawCnDataset;
  index = buildCnIndex(raw);
  setCnIndexForTests(index);
}, 120_000);

const card = (overrides: Partial<DetectedCard>): DetectedCard => ({
  name: '派帕',
  englishName: 'Arven',
  number: '161',
  total: '127',
  setCode: 'CSV1C',
  holo: true,
  language: 'zh-cn',
  box: null,
  confidence: 0.9,
  ...overrides,
});

describe('каталог КНР на настоящем наборе', () => {
  it('собирает сеты и карты со сканами, сжатый каталог небольшой', () => {
    expect(index.sets.length).toBeGreaterThan(150);
    const cards = index.sets.reduce((sum, set) => sum + set.cards.length, 0);
    expect(cards).toBeGreaterThan(8000);
    expect(index.sets.flatMap((set) => set.cards).filter((item) => item.prints.length === 0)).toEqual([]);
    // В IndexedDB лежит именно это: больше десятка мегабайт держать незачем
    expect(JSON.stringify(index).length).toBeLessThan(15_000_000);
  });

  it('CSV1C 161/127 — Arven SAR, печать с ID официальной базы 11988', async () => {
    const detail = await cnCatalog.card('CSV1C-161');
    expect(detail.name).toBe('派帕');
    expect(detail.localId).toBe('161');
    expect(detail.rarity).toBe('Special Art Rare');
    expect(detail.category).toBe('Trainer');
    expect(detail.image).toMatch(/^https:\/\/raw\.githubusercontent\.com\/duanxr\/PTCG-CHS-Datasets\/main\/img\/.+\.png$/);
    const found = await cnCatalog.find('CSV1C-161');
    expect(found?.card.prints.map((print) => print.o)).toContain(11988);
    const head = await fetch(detail.image!, { method: 'HEAD' });
    expect(head.ok).toBe(true);
  });

  it('у обычной карты три печати сводятся в одну карту с реверсом', async () => {
    const detail = await cnCatalog.card('CSV1C-001');
    expect(detail.name).toBe('榛果球');
    expect(detail.rarity).toBe('Common');
    expect(detail.variants).toEqual({ normal: true, holo: false, reverse: true });
  });

  it('поиск по имени и номеру находит карту и в коробках 151 — в самом раннем товаре', () => {
    const found = searchCnIndex(index, '派帕', '161');
    expect(found.map((item) => item.id)).toContain('CSV1C-161');
    const pikachu = searchCnIndex(index, '皮卡丘', '025');
    expect(pikachu.length).toBeGreaterThan(0);
  });

  it('сканер узнаёт карту по коду сета и номеру, и без кода — по имени и номеру', async () => {
    const byCode = decide(await findCandidates(card({})));
    expect(byCode.status).toBe('ready');
    if (byCode.status === 'ready') {
      expect(byCode.pick.cardId).toBe('CSV1C-161');
      expect(byCode.pick.englishName).toBe('Arven');
    }
    const byName = await findCandidates(card({ setCode: null }));
    expect(byName.map((item) => item.cardId)).toContain('CSV1C-161');
  });

  it('PikaQian отдаёт сет csv1c и цену Arven по ID печати', async () => {
    const cards = await fetchPikaqianSet('CSV1C');
    expect(cards?.length).toBeGreaterThan(100);
    const found = await cnCatalog.find('CSV1C-161');
    const match = matchPikaqian(cards!, found!.card);
    expect(match?.englishName).toBe('Arven');
    const prices = await refreshCnPrices(['CSV1C-161', 'CSV1C-001']);
    expect(prices.get('CSV1C-161')?.u).toBeGreaterThan(0);
    expect(prices.get('CSV1C-161')?.e).toBeNull();
    expect(prices.has('CSV1C-001')).toBe(true);
  });
});
