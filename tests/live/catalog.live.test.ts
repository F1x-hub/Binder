import { describe, expect, it } from 'vitest';
import { findCandidates } from '@/lib/catalog';
import { limitlessImage } from '@/lib/limitless';
import { decide, normalizeNumber, type DetectedCard } from '@/lib/matching';
import { priceFromCard } from '@/lib/prices';
import { tcgdexApi } from '@/lib/tcgdex';

/**
 * Проверка сопоставления на настоящем TCGdex (нужен интернет): npm run test:live.
 * В обычный npm test не входит, чтобы не нагружать бесплатный сервис.
 */
const read = (card: Partial<DetectedCard>): DetectedCard => ({
  name: '',
  englishName: null,
  number: '',
  total: null,
  setCode: null,
  holo: null,
  language: 'en',
  box: null,
  confidence: 0.9,
  ...card,
});

async function decision(card: Partial<DetectedCard>) {
  return decide(await findCandidates(read(card)));
}

describe('сопоставление с настоящим TCGdex', () => {
  it('Charizard ex 125/197 OBF узнаётся сразу', async () => {
    expect(await decision({ name: 'Charizard ex', number: '125', total: '197', setCode: 'OBF' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'sv03-125', setName: 'Obsidian Flames', printedTotal: 197, lang: 'en', approximate: false },
    });
  });

  it('опечатка в имени не мешает найти карту', async () => {
    const result = await decision({ name: 'Charizrd ex', number: '125', total: '197' });
    const first = result.status === 'ready' ? result.pick : result.status === 'choose' ? result.options[0] : null;
    expect(first?.cardId).toBe('sv03-125');
  });

  it('французская карта — та же, что в английском каталоге', async () => {
    expect(
      await decision({ name: 'Dracaufeu ex', englishName: 'Charizard ex', number: '125', total: '197', language: 'fr' }),
    ).toMatchObject({ status: 'ready', pick: { cardId: 'sv03-125', lang: 'en' } });
  });

  it('номер без ведущих нулей', async () => {
    expect(await decision({ name: 'Oddish', number: '1', total: '197' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'sv03-001' },
    });
  });

  it('старая карта Base Set', async () => {
    expect(await decision({ name: 'Charizard', number: '4', total: '102' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'base1-4' },
    });
  });

  it('номер сверяется строго: по «003» не находится карта под номером 073', async () => {
    const candidates = await findCandidates(read({ name: 'Mega Gengar ex', number: '003', total: '021', setCode: 'mBG' }));
    // Карты с номером 3 в английской базе нет. Другие печати Mega Gengar ex (в том числе mep-073)
    // предлагаются на выбор с пометкой «номер не подтверждён», но за номер 003 не выдаются
    const confirmed = candidates.filter((candidate) => !candidate.weak);
    expect(confirmed.map((candidate) => candidate.cardId)).not.toContain('mep-073');
    expect(confirmed.every((candidate) => normalizeNumber(candidate.localId) === '3')).toBe(true);
    expect(decide(candidates, 0.95).status).not.toBe('ready');
  });

  it('японская карта ищется в японском каталоге по напечатанному имени', async () => {
    expect(
      await decision({
        name: 'ゲンガー',
        englishName: 'Gengar',
        number: '094',
        total: '165',
        setCode: 'SV2a',
        language: 'ja',
      }),
    ).toMatchObject({ status: 'ready', pick: { cardId: 'SV2a-094', setId: 'SV2a', lang: 'ja', approximate: false } });
  });

  it('японская карта находится по коду сета и номеру, даже если имя прочитано по-английски', async () => {
    const result = await decision({ name: 'Gengar', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a', language: 'ja' });
    const first = result.status === 'ready' ? result.pick : result.status === 'choose' ? result.options[0] : null;
    expect(first?.cardId).toBe('SV2a-094');
  });

  it('японской карты из стартового набора MBG нет в TCGdex, но она находится в Limitless', async () => {
    expect(
      await decision({
        name: 'メガゲンガーex',
        englishName: 'Mega Gengar ex',
        number: '003',
        total: '021',
        setCode: 'mBG',
        language: 'ja',
      }),
    ).toMatchObject({
      status: 'ready',
      pick: { source: 'limitless', setId: 'MBG', localId: '3', name: 'メガゲンガーex', englishName: 'Mega Gengar ex' },
    });
  });

  it('по коду сета и номеру из Limitless чужая карта не подставляется', async () => {
    const candidates = await findCandidates(
      read({ name: 'ピカチュウ', englishName: 'Pikachu', number: '003', total: '021', setCode: 'MBG', language: 'ja' }),
    );
    // Под MBG #3 лежит メガゲンガーex: её быть не должно, а настоящие Пикачу №3 (промо) — пусть будут
    expect(candidates.map((candidate) => candidate.cardId)).not.toContain('lt:MBG-3');
    expect(candidates.every((candidate) => candidate.name.includes('ピカチュウ'))).toBe(true);
  });

  it('сканы Limitless открываются по адресу из кода сета и номера', async () => {
    for (const url of [
      limitlessImage({ region: 'jp', set: 'MBG', number: '003' }, 'SM')!,
      limitlessImage({ region: 'jp', set: 'M2a', number: '230' }, 'SM')!,
      limitlessImage({ region: 'en', set: 'MEP', number: '73' }, 'SM')!,
    ]) {
      const response = await fetch(url, { method: 'HEAD' });
      expect(response.status, url).toBe(200);
    }
  });

  it('язык не определён — только варианты на выбор из английской базы', async () => {
    const result = await decision({ name: 'Charizard ex', number: '125', total: '197', language: 'other' });
    expect(result.status).toBe('choose');
    const options = result.status === 'choose' ? result.options : [];
    expect(options[0]).toMatchObject({ cardId: 'sv03-125', approximate: true });
    expect(options.every((option) => option.approximate && !option.weak)).toBe(true);
  });

  it('корейские и китайские карты для КНР в базе не ищутся', async () => {
    expect(await findCandidates(read({ name: '리자몽ex', number: '125', language: 'ko' }))).toEqual([]);
  });

  it('карты TCG Pocket в кандидаты не попадают', async () => {
    const candidates = await findCandidates(read({ name: 'Charizard ex', number: '036' }));
    expect(candidates.every((candidate) => !/^(?:P-A|[A-Z]\d)/.test(candidate.cardId))).toBe(true);
  });

  it('выдуманная карта не находится', async () => {
    expect(await decision({ name: 'Blorptastic ex', number: '999', total: '998' })).toEqual({ status: 'not-found' });
  });

  it('цена читается из карточки TCGdex', async () => {
    const price = priceFromCard(await tcgdexApi.card('sv03-125'));
    expect(price.u === null || price.u > 0).toBe(true);
    expect(price.e === null || price.e > 0).toBe(true);
    expect(price.u !== null || price.e !== null).toBe(true);
  });

  it('у японской карты цена только с Cardmarket', async () => {
    const price = priceFromCard(await tcgdexApi.card('SV2a-094', 'ja'));
    expect(price.u).toBeNull();
    expect(price.e === null || price.e > 0).toBe(true);
  });
});
