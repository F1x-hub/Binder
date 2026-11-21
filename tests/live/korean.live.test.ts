import { describe, expect, it } from 'vitest';
import { catalog, findCandidates } from '@/lib/catalog';
import { koCatalog } from '@/lib/ko-catalog';
import { krwToUsd, usdFrom } from '@/lib/ko-prices';
import { decide, type DetectedCard } from '@/lib/matching';
import { fetchPokepolioSet, matchPokepolio, parsePokepolioList } from '@/lib/pokepolio';

/**
 * Корейские карты на настоящих выгрузках официальной базы (GitHub), сканах pokemoncard.co.kr,
 * Limitless (английские имена) и pokepolio (цены): npm run test:live. Запросов немного:
 * несколько файлов карт, один список сетов ce-dric и type-null (api.github.com, лимит 60 в час),
 * одна страница списка и одна страница сета pokepolio, один курс.
 */
const korean = (card: Partial<DetectedCard>): DetectedCard => ({
  name: '',
  englishName: null,
  number: '',
  total: null,
  setCode: null,
  holo: false,
  language: 'ko',
  box: null,
  confidence: 0.9,
  ...card,
});

async function scanOk(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const response = await fetch(url, { method: 'HEAD' });
  return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');
}

describe('корейские карты', () => {
  it('팬텀 094/165 SV2a (type-null) — корейский Gengar из 151 со сканом официального сайта, узнан сразу', async () => {
    const candidates = await findCandidates(korean({ name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' }));
    const first = candidates[0];
    expect(first, JSON.stringify(candidates)).toMatchObject({
      cardId: 'SV2a-094',
      setId: 'SV2a',
      name: '팬텀',
      lang: 'ko',
      approximate: false,
      englishName: 'Gengar',
      printedTotal: 165,
    });
    expect(decide(candidates).status).toBe('ready');
    expect(await scanOk(first!.image)).toBe(true);
  });

  it('뮤 ex 135/103 M6a (ce-dric, секретная карта: у type-null её нет) — найден по коду в другом регистре, скан отвечает', async () => {
    const candidates = await findCandidates(korean({ name: '뮤 ex', englishName: 'Mew ex', number: '135', total: '103', setCode: 'M6A' }));
    expect(candidates[0], JSON.stringify(candidates)).toMatchObject({ cardId: 'M6a-135', setId: 'M6a', name: '뮤 ex', lang: 'ko' });
    expect(await scanOk(candidates[0]!.image)).toBe(true);
    const detail = await catalog.card('M6a-135', 'ko');
    expect(detail.rarity).toBe('Full Art Ultra Rare');
  });

  it('야나프 001/066 SV4K без кода сета — через японскую пару по числу карт; чужое имя отброшено', async () => {
    const candidates = await findCandidates(korean({ name: '야나프', englishName: 'Pansage', number: '001', total: '066' }));
    expect(candidates.map((candidate) => candidate.cardId), JSON.stringify(candidates)).toContain('SV4K-001');
    const wrong = await findCandidates(korean({ name: '피카츄', englishName: 'Pikachu', number: '094', total: '165', setCode: 'SV2a' }));
    expect(wrong.map((candidate) => candidate.cardId)).not.toContain('SV2a-094');
  });

  it('документ «SV2a-094_ko» читается из корейского каталога', async () => {
    const found = await koCatalog.find('SV2a', '094');
    expect(found?.card).toMatchObject({ id: 'SV2a-094', name: '팬텀' });
  });

  it('цена с pokepolio: сет узнаётся по сканам, корейская карта находится по номеру и имени, курс вона', async () => {
    const response = await fetch('https://www.pokepolio.com/cards-list');
    expect(response.ok).toBe(true);
    const { sets, pages } = parsePokepolioList(await response.text());
    expect(pages).toBeGreaterThan(5);
    const m2a = sets.find((set) => set.code === 'M2a');
    expect(m2a, JSON.stringify(sets)).toBeTruthy();
    const listed = await fetchPokepolioSet(m2a!.uuid);
    expect(listed.length).toBeGreaterThan(100);
    expect(listed.filter((card) => card.krw !== null).length).toBeGreaterThan(10);
    const ours = (await catalog.set('M2a', 'ko')).cards;
    const priced = ours.map((card) => matchPokepolio(listed, card)).filter((card) => card?.krw);
    expect(priced.length).toBeGreaterThan(10);
    const rate = await krwToUsd();
    expect(rate).toBeGreaterThan(0.0003);
    expect(rate).toBeLessThan(0.002);
    expect(usdFrom(priced[0]!.krw, rate)).toBeGreaterThan(0);
  });
});
