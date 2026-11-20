import { describe, expect, it } from 'vitest';
import { CARD_FORMS, DECK_FORMS, NBSP, SET_FORMS, countLabel, formatUsd, invitesLeftLabel } from '@/lib/format';

describe('invitesLeftLabel', () => {
  it('пишет остаток приглашений как в макете', () => {
    expect(invitesLeftLabel(3)).toBe(`Осталось 3${NBSP}приглашения`);
    expect(invitesLeftLabel(1)).toBe(`Осталось 1${NBSP}приглашение`);
    expect(invitesLeftLabel(5)).toBe(`Осталось 5${NBSP}приглашений`);
  });

  it('при нуле пишет, что приглашений не осталось', () => {
    expect(invitesLeftLabel(0)).toBe('Приглашений не осталось');
  });
});

describe('countLabel', () => {
  it('склоняет слово по числу', () => {
    expect(countLabel(1, CARD_FORMS)).toBe(`1${NBSP}карточка`);
    expect(countLabel(3, CARD_FORMS)).toBe(`3${NBSP}карточки`);
    expect(countLabel(5, CARD_FORMS)).toBe(`5${NBSP}карточек`);
    expect(countLabel(11, CARD_FORMS)).toBe(`11${NBSP}карточек`);
    expect(countLabel(21, CARD_FORMS)).toBe(`21${NBSP}карточка`);
    expect(countLabel(0, CARD_FORMS)).toBe(`0${NBSP}карточек`);
  });

  it('совпадает с подписями из макетов', () => {
    expect(countLabel(148, CARD_FORMS)).toBe(`148${NBSP}карточек`);
    expect(countLabel(6, SET_FORMS)).toBe(`6${NBSP}сетов`);
    expect(countLabel(2, DECK_FORMS)).toBe(`2${NBSP}колоды`);
  });
});

describe('formatUsd', () => {
  it('пишет суммы без центов, с пробелом между разрядами', () => {
    expect(formatUsd(1284)).toBe(`$1${NBSP}284`);
    expect(formatUsd(0)).toBe('$0');
  });

  it('пишет цену карточки с центами через запятую', () => {
    expect(formatUsd(24.8, true)).toBe('$24,80');
    expect(formatUsd(0.9, true)).toBe('$0,90');
  });
});
