import { describe, expect, it } from 'vitest';
import { findTwCard, searchTwCandidates, twCard } from '@/lib/asia-tw';
import { findCandidates } from '@/lib/catalog';
import type { DetectedCard } from '@/lib/matching';

// Официальный сайт Pokémon Asia для Тайваня (нужен интернет): поиск, страница карты, скан.

const card = (overrides: Partial<DetectedCard>): DetectedCard => ({
  name: '妙蛙種子',
  englishName: 'Bulbasaur',
  number: '001',
  total: '165',
  setCode: 'SV2a',
  holo: false,
  language: 'zh-tw',
  box: null,
  confidence: 0.9,
  ...overrides,
});

describe('сайт Pokémon Asia (Тайвань)', () => {
  it('читает страницу карты: имя, номер, код сета и скан', async () => {
    const found = await twCard(8124);
    expect(found).toMatchObject({ name: '妙蛙種子', number: '001', total: '165', setCode: 'SV2a' });
    const head = await fetch(found!.image, { method: 'HEAD' });
    expect(head.ok).toBe(true);
    expect(head.headers.get('content-type')).toMatch(/image\/png/);
  });

  it('находит скан карты TCGdex по коду сета, номеру и имени и не берёт чужое имя', async () => {
    expect((await findTwCard({ name: '妙蛙種子', number: '001', setCode: 'SV2a' }))?.detailId).toBe(8124);
    expect(await findTwCard({ name: '小火龍', number: '001', setCode: 'SV2a' })).toBeNull();
  });

  it('карта нового сета, которого в TCGdex нет (M6a, 30th CELEBRATION), находится на сайте', async () => {
    const found = await searchTwCandidates(card({ name: '蛋蛋', englishName: 'Exeggcute', number: '001', total: '103', setCode: 'M6a' }));
    expect(found[0]).toMatchObject({ source: 'asia', name: '蛋蛋', localId: '001', setId: 'M6a', lang: 'zh-tw' });
    expect(found[0]!.image).toMatch(/\/tw\/card-img\/tw\d{8}\.png$/);
  });

  it('сканер для тайваньской карты из TCGdex берёт скан с сайта, если у TCGdex его нет', async () => {
    const found = await findCandidates(card({ number: '166', name: '妙蛙種子' }));
    // SV2a 166 — арт-редкость, в TCGdex без скана (сканы там только у первых 20 карт сета)
    const pick = found.find((item) => item.localId === '166');
    expect(pick?.image).toBeTruthy();
  });
});
