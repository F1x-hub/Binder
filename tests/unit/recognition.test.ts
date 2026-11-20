import { describe, expect, it } from 'vitest';
import { RecognizeError, parseBox, parseRecognition, recognizeErrorMessage } from '@/lib/deepseek';

describe('parseRecognition', () => {
  it('читает карты из ответа модели', () => {
    const cards = parseRecognition(
      JSON.stringify({
        cards: [
          {
            name: 'Charizard ex',
            englishName: 'Charizard ex',
            number: '125',
            total: '197',
            setCode: 'OBF',
            language: 'en',
            holo: true,
            box: [100, 50, 600, 950],
            confidence: 0.94,
          },
        ],
      }),
    );
    expect(cards).toEqual([
      {
        name: 'Charizard ex',
        englishName: 'Charizard ex',
        number: '125',
        total: '197',
        setCode: 'OBF',
        holo: true,
        language: 'en',
        box: [0.1, 0.05, 0.5, 0.9],
        confidence: 0.94,
      },
    ]);
  });

  it('японская карта из того фото: язык, код сета и номер как напечатаны', () => {
    const [card] = parseRecognition(
      JSON.stringify({
        cards: [
          {
            name: 'メガゲンガーex',
            englishName: 'Mega Gengar ex',
            number: '003',
            total: '021',
            setCode: 'mBG',
            language: 'ja',
            holo: true,
            box: [80, 40, 920, 960],
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(card).toMatchObject({ name: 'メガゲンガーex', number: '003', total: '021', setCode: 'mBG', language: 'ja' });
  });

  it('пропускает карты без имени или номера', () => {
    const cards = parseRecognition(JSON.stringify({ cards: [{ name: 'Pikachu' }, { number: '5' }, { name: 'Mew', number: '151' }] }));
    expect(cards.map((card) => card.name)).toEqual(['Mew']);
  });

  it('нормализует пустые поля и уверенность', () => {
    const [card] = parseRecognition(
      JSON.stringify({ cards: [{ name: ' Eevee ', number: '1 33', total: '', setCode: null, holo: 'yes', confidence: 7 }] }),
    );
    expect(card).toEqual({
      name: 'Eevee',
      englishName: null,
      number: '133',
      total: null,
      setCode: null,
      holo: null,
      language: 'other',
      box: null,
      confidence: 1,
    });
  });

  it('язык: разные записи кода сводятся к нашим', () => {
    const language = (value: unknown) =>
      parseRecognition(JSON.stringify({ cards: [{ name: 'Pikachu', number: '1', language: value }] }))[0]!.language;
    expect(language('JP')).toBe('ja');
    expect(language('zh_TW')).toBe('zh-tw');
    expect(language('zh-Hans')).toBe('zh-cn');
    expect(language('pt-BR')).toBe('pt');
    expect(language('Korean')).toBe('ko');
    expect(language('klingon')).toBe('other');
    expect(language(42)).toBe('other');
  });

  it('письменность имени важнее ответа модели', () => {
    const language = (name: string, value: string) =>
      parseRecognition(JSON.stringify({ cards: [{ name, number: '1', language: value }] }))[0]!.language;
    expect(language('ピカチュウ', 'en')).toBe('ja');
    expect(language('피카츄', 'ja')).toBe('ko');
    expect(language('Пикачу', 'en')).toBe('ru');
    // По одним иероглифам японскую карту от китайской не отличить: решает модель
    expect(language('皮卡丘', 'zh-tw')).toBe('zh-tw');
  });

  it('на неверный JSON отвечает пустым списком', () => {
    expect(parseRecognition('')).toEqual([]);
    expect(parseRecognition('not json')).toEqual([]);
    expect(parseRecognition(JSON.stringify({ cards: 'nope' }))).toEqual([]);
  });

  it('берёт не больше 20 карт', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ name: `Card ${index}`, number: String(index) }));
    expect(parseRecognition(JSON.stringify({ cards: many }))).toHaveLength(20);
  });
});

describe('parseBox', () => {
  it('углы в тысячных становятся рамкой в долях', () => {
    expect(parseBox([250, 100, 750, 900])).toEqual([0.25, 0.1, 0.5, 0.8]);
  });

  it('понимает и ответ в долях', () => {
    expect(parseBox([0.25, 0.1, 0.75, 0.9])).toEqual([0.25, 0.1, 0.5, 0.8]);
  });

  it('обрезает выход за край снимка', () => {
    expect(parseBox([-50, 0, 1200, 1000])).toEqual([0, 0, 1, 1]);
  });

  it('кривую рамку отбрасывает', () => {
    expect(parseBox([500, 500, 400, 900])).toBeNull();
    expect(parseBox([0, 0, 10, 10])).toBeNull();
    expect(parseBox([1, 2, 3])).toBeNull();
    expect(parseBox(['a', 0, 1, 1])).toBeNull();
    expect(parseBox(null)).toBeNull();
  });
});

describe('recognizeErrorMessage', () => {
  it('объясняет ошибки DeepSeek по-человечески', () => {
    expect(recognizeErrorMessage(new RecognizeError('invalid-key'))).toContain('Ключ DeepSeek не подошёл');
    expect(recognizeErrorMessage(new RecognizeError('no-balance'))).toContain('закончились деньги');
    expect(recognizeErrorMessage(new Error('???'))).toBe('Не получилось распознать фото.');
  });
});
