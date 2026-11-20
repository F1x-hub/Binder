import { describe, expect, it } from 'vitest';
import { RecognizeError, parseRecognition, recognizeErrorMessage } from '@/lib/deepseek';

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
            holo: true,
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
        confidence: 0.94,
      },
    ]);
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
      confidence: 1,
    });
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

describe('recognizeErrorMessage', () => {
  it('объясняет ошибки DeepSeek по-человечески', () => {
    expect(recognizeErrorMessage(new RecognizeError('invalid-key'))).toContain('Ключ DeepSeek не подошёл');
    expect(recognizeErrorMessage(new RecognizeError('no-balance'))).toContain('закончились деньги');
    expect(recognizeErrorMessage(new Error('???'))).toBe('Не получилось распознать фото.');
  });
});
