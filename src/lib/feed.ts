import { countLabel, type WordForms } from '@/lib/format';

/**
 * Лента «кто что добавил» без своей коллекции в Firestore: события берутся из альбомов,
 * которые страницы и так читают (альбомы друзей — из кэша браузера с дочитыванием,
 * src/lib/friends.ts; свой — из живой подписки вкладки). У карты альбома есть только
 * addedAt (когда документ появился) и updatedAt (когда его меняли в последний раз), поэтому
 * в ленте только появление новых карт. updatedAt не говорит, что поменялось: копию могли
 * добавить или убрать, могли поменять состояние. Удалённых карт в альбоме нет, и их
 * добавление из ленты пропадает вместе с ними.
 */

/** Добавления одного участника с перерывами не дольше получаса — один заход, одно событие. */
export const SESSION_GAP = 30 * 60 * 1000;

type Stamp = { toMillis(): number };

/** Что ленте нужно от карты: ID документа и когда она появилась в альбоме. */
export type FeedCard = { docId: string; addedAt: Stamp | null };

export type FeedSource<O, T> = { owner: O; cards: readonly T[] };

export type FeedEvent<O, T> = {
  /** Не меняется, когда к заходу добавляются новые карты: по нему React помнит раскрытые события */
  key: string;
  owner: O;
  /** Самое новое добавление в событии, мс */
  at: number;
  /** Самое раннее добавление в событии, мс */
  since: number;
  /** Новые сверху */
  cards: T[];
};

type Timed<T> = { card: T; at: number };

/** Позже — раньше; при равном времени (одна запись сканера) — по ID, чтобы порядок не прыгал. */
function newest<T extends FeedCard>(a: Timed<T>, b: Timed<T>): number {
  return b.at - a.at || a.card.docId.localeCompare(b.card.docId);
}

/**
 * События ленты, новые сверху. Карты одного участника, добавленные подряд с перерывами
 * не дольше gap, сворачиваются в одно событие: сканер добавляет фото с несколькими картами
 * одной записью, а за один заход обычно сканируют пачку. Карты без addedAt (время ещё
 * не пришло с сервера) пропускаются: через мгновение они придут со временем.
 */
export function buildFeed<O extends { uid: string }, T extends FeedCard>(
  sources: ReadonlyArray<FeedSource<O, T>>,
  gap = SESSION_GAP,
): FeedEvent<O, T>[] {
  const events: FeedEvent<O, T>[] = [];
  for (const { owner, cards } of sources) {
    const timed = cards
      .flatMap((card): Timed<T>[] => (card.addedAt ? [{ card, at: card.addedAt.toMillis() }] : []))
      .sort(newest);
    let group: Timed<T>[] = [];
    const flush = () => {
      const first = group[0];
      const oldest = group[group.length - 1];
      if (!first || !oldest) return;
      events.push({
        key: `${owner.uid}:${oldest.at}:${oldest.card.docId}`,
        owner,
        at: first.at,
        since: oldest.at,
        cards: group.map((item) => item.card),
      });
      group = [];
    };
    for (const item of timed) {
      const previous = group[group.length - 1];
      if (previous && previous.at - item.at > gap) flush();
      group.push(item);
    }
    flush();
  }
  return events.sort((a, b) => b.at - a.at || a.owner.uid.localeCompare(b.owner.uid));
}

export const NEW_CARD_FORMS: WordForms = ['новая карта', 'новые карты', 'новых карт'];
/** После «из»: «из 21 сета», «из 4 сетов» */
const SET_GENITIVE: WordForms = ['сета', 'сетов', 'сетов'];

/**
 * Сеты события по убыванию числа карт, при равенстве — в порядке карт (новые первыми).
 * null — карта вне базы без кода сета: у неё нет имени сета, она идёт отдельной группой.
 */
export function eventSets(setNames: ReadonlyArray<string | null>): { named: string[]; unnamed: boolean } {
  const counts = new Map<string, number>();
  let unnamed = false;
  for (const name of setNames) {
    if (name === null) unnamed = true;
    else counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const named = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
  return { named, unnamed };
}

/**
 * Свёрнутое событие словами: «5 новых карт из Surging Sparks», «3 новые карты из 151 и MBG»,
 * «12 новых карт из 4 сетов». Глагола нет: в Binder не знают, как участник говорит о себе,
 * а «добавила» или «добавил» угадывать по имени нельзя.
 */
export function groupTitle(setNames: ReadonlyArray<string | null>): string {
  const count = countLabel(setNames.length, NEW_CARD_FORMS);
  const { named, unnamed } = eventSets(setNames);
  if (named.length === 0) return count;
  if (named.length === 1 && !unnamed) return `${count} из ${named[0]}`;
  if (named.length === 2 && !unnamed) return `${count} из ${named[0]} и ${named[1]}`;
  const sets = named.length + (unnamed ? 1 : 0);
  return `${count} из ${countLabel(sets, SET_GENITIVE)}`;
}
