import { describe, expect, it } from 'vitest';
import {
  READY_SCORE,
  coreName,
  decide,
  lastWord,
  localIdVariants,
  nameScore,
  nameSimilarity,
  nameVerdict,
  namesMatch,
  normalizeNumber,
  sameNumber,
  scoreCandidate,
  scriptOf,
  searchName,
  type Candidate,
  type DetectedCard,
} from '@/lib/matching';

const detected = (card: Partial<DetectedCard>): DetectedCard => ({
  name: 'Charizard ex',
  englishName: null,
  number: '125',
  total: '197',
  setCode: null,
  holo: null,
  language: 'en',
  box: null,
  confidence: 0.9,
  ...card,
});

const candidate = (card: Partial<Candidate>): Candidate => ({
  cardId: 'sv03-125',
  setId: 'sv03',
  name: 'Charizard ex',
  localId: '125',
  setName: 'Obsidian Flames',
  printedTotal: 197,
  setCode: 'OBF',
  releaseDate: '2023-08-11',
  lang: 'en',
  approximate: false,
  source: 'tcgdex',
  score: 0,
  ...card,
});

describe('номера карт', () => {
  it('убирает ведущие нули и приводит к верхнему регистру', () => {
    expect(normalizeNumber('057')).toBe('57');
    expect(normalizeNumber('000')).toBe('0');
    expect(normalizeNumber(' tg05 ')).toBe('TG05');
  });

  it('даёт все варианты записи номера для поиска', () => {
    expect(localIdVariants('57')).toEqual(['57', '057']);
    expect(localIdVariants('057')).toEqual(['057', '57']);
    expect(localIdVariants('125')).toEqual(['125']);
    expect(localIdVariants('TG05')).toEqual(['TG05']);
  });

  it('сравнивает номера без ведущих нулей, но не по вхождению', () => {
    expect(sameNumber('003', '3')).toBe(true);
    expect(sameNumber('003', '073')).toBe(false);
    expect(sameNumber('tg05', 'TG05')).toBe(true);
  });
});

describe('имена', () => {
  it('для поиска убирает механики на конце', () => {
    expect(searchName('Charizard ex')).toBe('Charizard');
    expect(searchName('Pikachu VMAX')).toBe('Pikachu');
    expect(searchName("Professor's Research")).toBe("Professor's Research");
  });

  it('у японских имён механика пишется слитно, а у латинских слитное «ex» — часть слова', () => {
    expect(searchName('メガゲンガーex')).toBe('メガゲンガー');
    expect(searchName('ゲンガー&ミミッキュGX')).toBe('ゲンガー&ミミッキュ');
    expect(searchName('Pokédex')).toBe('Pokédex');
  });

  it('полноширинные буквы становятся обычными', () => {
    expect(searchName('リザードンｅｘ')).toBe('リザードン');
  });

  it('последнее слово — запасной вариант поиска', () => {
    expect(lastWord('Mega Charizard X')).toBe('Charizard');
    expect(lastWord('Mew')).toBe('Mew');
  });

  it('похожесть не зависит от регистра и диакритики', () => {
    expect(nameSimilarity('Charizard ex', 'charizard EX')).toBe(1);
    expect(nameSimilarity('Flabébé', 'Flabebe')).toBe(1);
    expect(nameSimilarity('Charizrd ex', 'Charizard ex')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Pikachu', 'Charizard')).toBeLessThan(0.4);
  });

  it('японские имена тоже сравниваются, а не превращаются в пустоту', () => {
    expect(nameSimilarity('メガゲンガーex', 'メガゲンガーex')).toBe(1);
    expect(nameSimilarity('ゲンガー', 'ピカチュウ')).toBeLessThan(0.4);
  });

  it('общие «Mega» и «ex» не делают разных покемонов похожими', () => {
    expect(nameSimilarity('Mega Gengar ex', 'Mega Venusaur ex')).toBeGreaterThan(0.7);
    expect(namesMatch('Mega Gengar ex', 'Mega Venusaur ex')).toBeLessThan(0.55);
    expect(namesMatch('メガゲンガーex', 'メガフシギバナex')).toBe(0);
    expect(namesMatch('Charizrd ex', 'Charizard ex')).toBeGreaterThan(0.85);
    expect(namesMatch('M Gengar-EX', 'Mega Gengar ex')).toBeGreaterThanOrEqual(0.75);
    expect(coreName('Mega Gengar ex')).toBe('Gengar');
    expect(coreName('メガゲンガーex')).toBe('ゲンガー');
    expect(coreName('M Rayquaza-EX')).toBe('Rayquaza');
  });

  it('письменность имени', () => {
    expect(scriptOf('メガゲンガーex')).toBe('cjk');
    expect(scriptOf('皮卡丘')).toBe('cjk');
    expect(scriptOf('Pikachu')).toBe('latin');
    expect(scriptOf('피카츄')).toBe('hangul');
  });

  it('японская карта и японская база: решает напечатанное имя, а не английское', () => {
    const gengar = { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', language: 'ja' as const };
    // Так сканер 20 ноября 2026 принял Mega Gengar ex за Mega Venusaur ex
    expect(nameVerdict(gengar, { name: 'メガフシギバナex', lang: 'ja', englishName: 'Mega Venusaur ex' })).toBe(0);
    expect(nameVerdict(gengar, { name: 'メガゲンガーex', lang: 'ja', englishName: 'Mega Gengar ex' })).toBe(1);
  });

  it('французская карта и английская база: сравниваются английские имена', () => {
    const card = { name: 'Dracaufeu ex', englishName: 'Charizard ex', language: 'fr' as const };
    expect(nameVerdict(card, { name: 'Charizard ex', lang: 'en' })).toBe(1);
    expect(nameVerdict(card, { name: 'Pikachu ex', lang: 'en' })).toBeLessThan(0.5);
  });

  it('японское имя прочитано латиницей: сравнить можно только с английским именем из базы', () => {
    const card = { name: 'Gengar', englishName: 'Gengar', language: 'ja' as const };
    expect(nameVerdict(card, { name: 'ゲンガー', lang: 'ja' })).toBeNull();
    expect(nameVerdict(card, { name: 'ゲンガー', lang: 'ja', englishName: 'Gengar' })).toBe(1);
    expect(nameScore(card, { name: 'ゲンガー', lang: 'ja' })).toBe(0);
  });
});

describe('оценка и решение', () => {
  it('точное совпадение имени, числа карт и кода сета даёт максимум', () => {
    expect(scoreCandidate(detected({ setCode: 'OBF' }), candidate({}))).toBe(1);
  });

  it('без кода сета точная карта всё равно проходит порог', () => {
    expect(scoreCandidate(detected({}), candidate({}))).toBeGreaterThanOrEqual(READY_SCORE);
  });

  it('на японской карте код сета — это ID сета в базе', () => {
    const gengar = detected({ name: 'ゲンガー', number: '094', total: '165', setCode: 'SV2a', language: 'ja' });
    const card = candidate({ cardId: 'SV2a-094', setId: 'SV2a', name: 'ゲンガー', localId: '094', printedTotal: 165, setCode: null, lang: 'ja' });
    expect(scoreCandidate(gengar, card)).toBe(1);
  });

  it('другой сет с тем же номером проигрывает', () => {
    const other = candidate({ cardId: 'me02-125', name: 'Mega Charizard X ex', printedTotal: 94, setCode: 'PFL' });
    expect(scoreCandidate(detected({}), other)).toBeLessThan(scoreCandidate(detected({}), candidate({})));
  });

  it('уверенный лидер — узнана сразу', () => {
    const decision = decide([candidate({ score: 0.95 }), candidate({ cardId: 'x-1', score: 0.5 })]);
    expect(decision).toMatchObject({ status: 'ready', pick: { cardId: 'sv03-125' } });
  });

  it('похожая карта из чужой базы не узнаётся сама, даже с высокой оценкой', () => {
    expect(decide([candidate({ score: 1, approximate: true })])).toMatchObject({ status: 'choose' });
  });

  it('два близких кандидата — выбор за человеком', () => {
    const decision = decide([candidate({ score: 0.9 }), candidate({ cardId: 'x-1', score: 0.85 })]);
    expect(decision).toMatchObject({ status: 'choose' });
  });

  it('слабый единственный кандидат — тоже на проверку', () => {
    expect(decide([candidate({ score: 0.5 })])).toMatchObject({ status: 'choose', options: [{ cardId: 'sv03-125' }] });
  });

  it('вариантов на выбор не больше трёх', () => {
    const many = [0.6, 0.59, 0.58, 0.57].map((score, index) => candidate({ cardId: `c-${index}`, score }));
    const decision = decide(many);
    expect(decision.status === 'choose' && decision.options).toHaveLength(3);
  });

  it('модель не уверена — выбор, даже если база сошлась идеально', () => {
    expect(decide([candidate({ score: 1 })], 0.55)).toMatchObject({ status: 'choose', options: [{ cardId: 'sv03-125' }] });
    expect(decide([candidate({ score: 1 })], 0.7)).toMatchObject({ status: 'ready' });
  });

  it('номер не подтверждён поиском — выбор', () => {
    expect(decide([candidate({ score: 0.95, weak: true })])).toMatchObject({ status: 'choose' });
  });

  it('с другими печатями той же карты вариантов больше трёх, при равной оценке свежий сет первым', () => {
    const prints = ['2024-01-01', '2026-09-16', '2025-05-05', '2023-03-03', '2022-02-02', '2021-01-01', '2020-01-01'].map(
      (releaseDate, index) => candidate({ cardId: `p-${index}`, score: 0.6, weak: true, releaseDate }),
    );
    const decision = decide([candidate({ score: 0.9 }), ...prints], 0.55);
    const options = decision.status === 'choose' ? decision.options : [];
    expect(options).toHaveLength(8);
    expect(options.map((option) => option.cardId).slice(0, 3)).toEqual(['sv03-125', 'p-1', 'p-2']);
  });

  it('пусто — не найдена', () => {
    expect(decide([])).toEqual({ status: 'not-found' });
  });
});
