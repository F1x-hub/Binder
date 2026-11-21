import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { clubKeysFrom } from '@/lib/club-keys';
import { ownedFromDoc, type OwnedCard } from '@/lib/collection';
import { blockUntil, nextUsage, type BlockReason, type KeyStates, type UsageMetadata } from '@/lib/justtcg-keys';
import { BATCH_LIMIT, JusttcgError, refreshJusttcgCards, setKeyStateStore, type KeyStateStore } from '@/lib/justtcg';
import { catalogFor, type TcgdexLanguage } from '@/lib/languages';
import { findJapaneseCard } from '@/lib/limitless';
import { normalizeNumber } from '@/lib/matching';
import {
  SERVER_FIELD,
  jpPriceDocId,
  priceDocId,
  refreshJapaneseSet,
  refreshTcgdexPrices,
  utcDay,
  type JapaneseRef,
  type StoredJapanesePrice,
  type StoredPrice,
} from '@/lib/price-refresh';
import type { CardDetail } from '@/lib/tcgdex';

/**
 * Ежедневное освежение цен клуба (GitHub Actions, scripts/refresh-prices.ts). Берёт карты
 * из альбомов всех участников, освежает цены TCGdex и доллары JustTCG по ключам клуба
 * (config/justtcg) и пишет их в те же документы prices/… и prices/…/months/{ГГГГ-ММ}, что
 * раньше писал браузер, с отметкой server = день. Admin SDK обходит правила Firestore.
 */

export type Log = (line: string) => void;

export type RefreshOptions = {
  today?: string;
  log?: Log;
  /** Не больше стольких запросов к JustTCG в минуту с одного ключа (бесплатный тариф — 10) */
  perMinute?: number;
  /** Для тестов: ожидание без настоящего времени */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Документы кэша: marked — освежён целиком и помечен задачей, partial — записаны только освежённые карты, skipped — не тронут. */
export type DocCounts = { marked: number; partial: number; skipped: number };

export type RefreshReport = {
  members: number;
  cards: number;
  tcgdex: { sets: number; cards: number; refreshed: number; failed: number; docs: DocCounts };
  justtcg: {
    sets: number;
    cards: number;
    refreshed: number;
    searched: number;
    left: number;
    keys: number;
    error: string | null;
    docs: DocCounts;
  };
};

/**
 * Состояние ключей JustTCG на время запуска: в памяти, как chrome.storage.local у браузера.
 * pace выдерживает темп: не больше perMinute запросов с ключа за скользящую минуту.
 */
export function memoryKeyStore({
  perMinute = 10,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: Pick<RefreshOptions, 'perMinute' | 'sleep' | 'now'> = {}): KeyStateStore & { states: KeyStates } {
  const states: KeyStates = {};
  const sent = new Map<string, number[]>();
  return {
    states,
    async load() {
      return states;
    },
    async success(key: string, metadata: UsageMetadata | undefined, at: number) {
      states[key] = { usage: nextUsage(states[key]?.usage, metadata, at) };
    },
    async block(key: string, reason: BlockReason, at: number) {
      states[key] = { ...states[key], block: { reason, until: blockUntil(reason, at) } };
    },
    async pace(key: string) {
      const times = sent.get(key) ?? [];
      const windowStart = now() - 60_000;
      const recent = times.filter((time) => time > windowStart);
      if (recent.length >= perMinute) {
        // Ждём, пока самый старый запрос минуты выйдет из окна, с запасом в секунду
        await sleep(recent[0]! - windowStart + 1_000);
      }
      recent.push(now());
      sent.set(key, recent.slice(-perMinute));
    },
  };
}

type Group<T> = Map<string, T[]>;

function push<T>(groups: Group<T>, key: string, item: T): void {
  const list = groups.get(key);
  if (list) list.push(item);
  else groups.set(key, [item]);
}

/** Все карты альбомов участников. Альбомы убранных из клуба остаются в базе, но цены им не нужны. */
export async function clubCards(db: Firestore): Promise<{ members: number; cards: OwnedCard[] }> {
  const members = await db.collection('members').get();
  const albums = await Promise.all(members.docs.map((member) => member.ref.collection('cards').get()));
  return { members: members.size, cards: albums.flatMap((album) => album.docs.map((card) => ownedFromDoc(card.id, card.data()))) };
}

/** Номер карты в сете из её ID в TCGdex: «SV2a-094» в сете «SV2a» → «094». */
function localIdOf(cardId: string, setId: string): string {
  return cardId.startsWith(`${setId}-`) ? cardId.slice(setId.length + 1) : (cardId.split('-').pop() ?? cardId);
}

/**
 * Японские карты, которым нужны доллары JustTCG — те же, что у браузера (japaneseRefs
 * в src/lib/useCardViews.ts): карты японского каталога TCGdex и японские карты вне базы
 * с кодом сета и английским именем. Номер и число карт берутся из карточки TCGdex.
 */
export function japaneseTargets(cards: OwnedCard[], details: Map<string, CardDetail>): JapaneseRef[] {
  return cards.flatMap((card): JapaneseRef[] => {
    const printing = card.variant ?? 'normal';
    if (card.catalog === 'ja' && card.lang === 'ja' && card.cardId) {
      const detail = details.get(`ja|${card.cardId}`);
      const number = detail?.localId ?? localIdOf(card.cardId, card.setId);
      const official = detail?.set.cardCount?.official;
      return [
        {
          key: card.docId,
          setCode: card.setId,
          number,
          total: official ? String(official) : null,
          englishName: null,
          resolveEnglishName: () => findJapaneseCard(card.setId, number).then((found) => found?.englishName ?? null),
          printing,
          verifyName: false,
        },
      ];
    }
    const { printed } = card;
    if (printed && card.lang === 'ja' && printed.setCode && printed.englishName) {
      return [
        {
          key: card.docId,
          setCode: printed.setCode,
          number: printed.number,
          total: printed.total,
          englishName: printed.englishName,
          printing,
          verifyName: true,
        },
      ];
    }
    return [];
  });
}

async function readCards<T>(db: Firestore, docId: string): Promise<Record<string, T>> {
  return ((await db.doc(`prices/${docId}`).get()).data()?.cards ?? {}) as Record<string, T>;
}

type Written = keyof DocCounts;

/**
 * Одна запись на документ кэша и одна на месяц истории, как у браузера, но точечно: пишутся
 * только пути cards.{ID} освежённых карт и {ID}.{ДД} истории (mergeFields), остальные карты
 * документа не трогаются. Пустую карту cards писать нельзя: при merge она заменила бы все
 * карты документа. mark — все карты альбомов в документе сегодня свежие, и документ получает
 * отметку задачи server; иначе прежняя отметка остаётся как была.
 */
async function writePrices(
  db: Firestore,
  docId: string,
  update: { cards: Record<string, unknown>; history: Record<string, Record<string, unknown>> },
  today: string,
  mark: boolean,
): Promise<Written> {
  const { cards, history } = update;
  const ids = Object.keys(cards);
  if (ids.length === 0 && !mark) return 'skipped';
  const fields = ids.map((id) => new FieldPath('cards', id));
  if (mark) fields.push(new FieldPath(SERVER_FIELD));
  const batch = db.batch();
  batch.set(db.doc(`prices/${docId}`), { cards, [SERVER_FIELD]: today }, { mergeFields: fields });
  const days = Object.entries(history).flatMap(([id, byDay]) => Object.keys(byDay).map((day) => new FieldPath(id, day)));
  if (days.length > 0) batch.set(db.doc(`prices/${docId}/months/${today.slice(0, 7)}`), history, { mergeFields: days });
  await batch.commit();
  return mark ? 'marked' : 'partial';
}

const noDocs = (): DocCounts => ({ marked: 0, partial: 0, skipped: 0 });

export async function refreshClubPrices(db: Firestore, options: RefreshOptions = {}): Promise<RefreshReport> {
  const today = options.today ?? utcDay();
  const log = options.log ?? (() => {});
  const { members, cards } = await clubCards(db);
  const report: RefreshReport = {
    members,
    cards: cards.length,
    tcgdex: { sets: 0, cards: 0, refreshed: 0, failed: 0, docs: noDocs() },
    justtcg: { sets: 0, cards: 0, refreshed: 0, searched: 0, left: 0, keys: 0, error: null, docs: noDocs() },
  };
  log(`Участников: ${members}, карт в альбомах: ${cards.length}`);

  // 1. TCGdex: карты каталогов, кроме похожих (у них цена была бы чужой)
  const bySet: Group<string> = new Map();
  for (const card of cards) {
    if (card.cardId && card.catalog && catalogFor(card.lang).exact) push(bySet, `${card.catalog}|${card.setId}`, card.cardId);
  }
  const details = new Map<string, CardDetail>();
  for (const [key, ids] of bySet) {
    const [lang, setId] = key.split('|') as [TcgdexLanguage, string];
    const docId = priceDocId(lang, setId);
    const unique = [...new Set(ids)];
    const stored = await readCards<StoredPrice>(db, docId);
    const stale = unique.filter((id) => stored[id]?.d !== today);
    const fresh = await refreshTcgdexPrices(lang, stale, today);
    for (const [id, detail] of fresh.details) details.set(`${lang}|${id}`, detail);
    const failed = stale.length - fresh.details.size;
    report.tcgdex.sets += 1;
    report.tcgdex.cards += unique.length;
    report.tcgdex.refreshed += fresh.details.size;
    report.tcgdex.failed += failed;
    // Отметка задачи — только если сет освежён целиком: иначе браузер ещё покажет свежую цену сам
    const written = await writePrices(db, docId, { cards: fresh.updates, history: fresh.history }, today, failed === 0);
    report.tcgdex.docs[written] += 1;
    log(
      `TCGdex ${docId}: карт ${unique.length}, уже свежих ${unique.length - stale.length}, освежено ${fresh.details.size}` +
        (failed ? `, не ответил по ${failed} — документ без отметки задачи` : ''),
    );
  }
  log(
    `TCGdex итог: документов ${report.tcgdex.sets}, помечено задачей ${report.tcgdex.docs.marked}, ` +
      `освежено частично ${report.tcgdex.docs.partial}, не тронуто ${report.tcgdex.docs.skipped}`,
  );

  // 2. JustTCG: доллары японских карт по ключам клуба
  const refs = japaneseTargets(cards, details);
  const keys = clubKeysFrom((await db.doc('config/justtcg').get()).data())
    .filter((item) => item.enabled)
    .map((item) => item.key);
  report.justtcg.keys = keys.length;
  const codes = new Set(refs.map((ref) => ref.setCode.trim().toUpperCase()));
  log(`JustTCG: включённых ключей клуба в config/justtcg — ${keys.length}, японских сетов в альбомах — ${codes.size}`);
  if (refs.length === 0) return report;
  if (keys.length === 0) {
    report.justtcg.error = 'no-key';
    report.justtcg.sets = codes.size;
    report.justtcg.docs.skipped = codes.size;
    log(`JustTCG: ключей JustTCG нет — японские цены не освежены, документы jt_* (${codes.size}) не тронуты и не помечены`);
    return report;
  }

  const store = memoryKeyStore(options);
  setKeyStateStore(store);
  try {
    const sets: Group<JapaneseRef> = new Map();
    for (const ref of refs) push(sets, ref.setCode.trim().toUpperCase(), ref);
    const known = new Map<string, Record<string, StoredJapanesePrice>>();
    for (const code of sets.keys()) known.set(code, await readCards<StoredJapanesePrice>(db, jpPriceDocId(code)));
    const fresh = new Map<string, { cards: Record<string, StoredJapanesePrice>; history: Record<string, Record<string, unknown>> }>();
    const freshOf = (code: string) => {
      let entry = fresh.get(code);
      if (!entry) fresh.set(code, (entry = { cards: {}, history: {} }));
      return entry;
    };
    report.justtcg.sets = sets.size;
    report.justtcg.cards = new Set(refs.map((ref) => `${ref.setCode.toUpperCase()}|${normalizeNumber(ref.number)}`)).size;

    // Порядок по цене в запросах: сначала известные карты всех сетов пакетами по 20 (дешевле всего),
    // потом карты, которых ещё ни разу не искали, и только потом те, что вчера не нашлись
    const batchable: Array<{ code: string; number: string; id: string }> = [];
    for (const [code, list] of sets) {
      const stored = known.get(code)!;
      for (const number of new Set(list.map((ref) => normalizeNumber(ref.number)))) {
        const entry = stored[number];
        if (entry?.j && entry.d !== today) batchable.push({ code, number, id: entry.j });
      }
    }
    for (let start = 0; start < batchable.length && !report.justtcg.error; start += BATCH_LIMIT) {
      const chunk = batchable.slice(start, start + BATCH_LIMIT);
      try {
        const prices = await refreshJusttcgCards(
          keys,
          chunk.map((item) => item.id),
        );
        for (const { code, number, id } of chunk) {
          const found = prices.get(id);
          if (!found) continue;
          const entry: StoredJapanesePrice = { ...known.get(code)![number]!, d: today, v: found };
          known.get(code)![number] = entry;
          freshOf(code).cards[number] = entry;
          if (Object.keys(found).length > 0) freshOf(code).history[number] = { [today.slice(8)]: found };
          report.justtcg.refreshed += 1;
        }
      } catch (error) {
        if (!(error instanceof JusttcgError)) throw error;
        report.justtcg.error = error.reason;
      }
    }

    for (const neverSearched of [true, false]) {
      for (const [code, list] of sets) {
        if (report.justtcg.error) break;
        const stored = known.get(code)!;
        const wanted = list.filter((ref) => {
          const entry = stored[normalizeNumber(ref.number)];
          return neverSearched ? !entry : Boolean(entry && !entry.j && entry.d !== today);
        });
        if (wanted.length === 0) continue;
        const result = await refreshJapaneseSet(keys, code, wanted, stored, today);
        for (const [number, entry] of Object.entries(result.fresh)) {
          stored[number] = entry;
          freshOf(code).cards[number] = entry;
          report.justtcg.searched += 1;
          if (entry.j) report.justtcg.refreshed += 1;
        }
        Object.assign(freshOf(code).history, result.history);
        if (result.error) report.justtcg.error = result.error.reason;
      }
    }

    for (const code of sets.keys()) {
      const entry = fresh.get(code);
      const stored = known.get(code)!;
      const complete = sets.get(code)!.every((ref) => stored[normalizeNumber(ref.number)]?.d === today);
      // Отметка задачи — только у сета, освежённого целиком
      const written = await writePrices(db, jpPriceDocId(code), entry ?? { cards: {}, history: {} }, today, complete);
      report.justtcg.docs[written] += 1;
      if (!complete) log(`JustTCG ${jpPriceDocId(code)}: освежены не все карты — документ без отметки задачи`);
    }
    report.justtcg.left = Object.values(store.states).reduce((sum, state) => sum + (state.usage?.dayLeft ?? 0), 0);
    log(
      `JustTCG: сетов ${report.justtcg.sets}, карт ${report.justtcg.cards}, освежено ${report.justtcg.refreshed}, ` +
        `искали ${report.justtcg.searched}, осталось запросов на сегодня ${report.justtcg.left}` +
        (report.justtcg.error ? `, остановились: ${report.justtcg.error}` : '') +
        `; документов помечено задачей ${report.justtcg.docs.marked}, освежено частично ${report.justtcg.docs.partial}, ` +
        `не тронуто ${report.justtcg.docs.skipped}`,
    );
  } finally {
    setKeyStateStore();
  }
  return report;
}
