import { describe, expect, it } from 'vitest';
import {
  READY_SCORE,
  decide,
  lastWord,
  localIdVariants,
  nameSimilarity,
  normalizeNumber,
  scoreCandidate,
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
});

describe('имена', () => {
  it('для поиска убирает механики на конце и берёт английское имя', () => {
    expect(searchName({ name: 'Charizard ex', englishName: null })).toBe('Charizard');
    expect(searchName({ name: 'Pikachu VMAX', englishName: null })).toBe('Pikachu');
    expect(searchName({ name: 'リザードンex', englishName: 'Charizard ex' })).toBe('Charizard');
    expect(searchName({ name: "Professor's Research", englishName: null })).toBe("Professor's Research");
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
});

describe('оценка и решение', () => {
  it('точное совпадение имени, числа карт и кода сета даёт максимум', () => {
    expect(scoreCandidate(detected({ setCode: 'OBF' }), candidate({}))).toBe(1);
  });

  it('без кода сета точная карта всё равно проходит порог', () => {
    expect(scoreCandidate(detected({}), candidate({}))).toBeGreaterThanOrEqual(READY_SCORE);
  });

  it('другой сет с тем же номером проигрывает', () => {
    const other = candidate({ cardId: 'me02-125', name: 'Mega Charizard X ex', printedTotal: 94, setCode: 'PFL' });
    expect(scoreCandidate(detected({}), other)).toBeLessThan(scoreCandidate(detected({}), candidate({})));
  });

  it('уверенный лидер — узнана сразу', () => {
    const decision = decide([candidate({ score: 0.95 }), candidate({ cardId: 'x-1', score: 0.5 })]);
    expect(decision).toMatchObject({ status: 'ready', pick: { cardId: 'sv03-125' } });
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

  it('пусто — не найдена', () => {
    expect(decide([])).toEqual({ status: 'not-found' });
  });
});
