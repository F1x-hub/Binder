import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { catalogFor, catalogIdOf, isCardLanguage, type CardLanguage, type TcgdexLanguage } from '@/lib/languages';
import { normalizeNumber } from '@/lib/matching';

export type Variant = 'normal' | 'holo' | 'reverse';

/** Состояние карты по шкале TCGplayer: цены в Binder даны для Near Mint. */
export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

/** Что напечатано на карте, которой нет в базе: по этому альбом её и показывает. */
export type PrintedCard = {
  name: string;
  englishName: string | null;
  number: string;
  total: string | null;
  setCode: string | null;
};

/** Ограничения длины те же, что в правилах Firestore. */
export const PRINTED_LIMITS = { name: 80, englishName: 80, number: 12, total: 12, setCode: 16 } as const;

/**
 * Документ members/{uid}/cards/{docId}. У карты из базы хранится ссылка на неё в TCGdex,
 * сколько копий, вариант печати и язык. У карты, которой в базе нет, вместо ссылки —
 * то, что на ней напечатано (printed). Данные карты из справочника не дублируются.
 */
export type OwnedCard = {
  docId: string;
  /** ID карты в каталоге TCGdex; null — карты в базе нет */
  cardId: string | null;
  /** Каталог TCGdex, в котором лежит карта */
  catalog: TcgdexLanguage | null;
  setId: string;
  lang: CardLanguage;
  count: number;
  variant?: Variant;
  /** Состояние; без поля — Near Mint */
  condition?: Condition;
  printed: PrintedCard | null;
  addedAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

/** Больше копий одной карты держать незачем, правила Firestore проверяют то же число. */
export const MAX_COPIES = 999;

export function cardsOf(db: Firestore, uid: string): CollectionReference {
  return collection(db, 'members', uid, 'cards');
}

function isPrinted(value: unknown): value is PrintedCard {
  const printed = value as Partial<PrintedCard> | null;
  return typeof printed?.name === 'string' && typeof printed.number === 'string';
}

/** Документ альбома в карту приложения. Карты из фазы 2 записаны без языка: все они английские. */
export function ownedFromDoc(docId: string, data: DocumentData): OwnedCard {
  const lang = isCardLanguage(data.lang) ? data.lang : 'en';
  const printed = isPrinted(data.printed)
    ? {
        name: data.printed.name,
        englishName: data.printed.englishName ?? null,
        number: data.printed.number,
        total: data.printed.total ?? null,
        setCode: data.printed.setCode ?? null,
      }
    : null;
  const catalog = printed ? null : catalogFor(lang).tcgdex;
  const variant = data.variant === 'normal' || data.variant === 'holo' || data.variant === 'reverse' ? data.variant : undefined;
  const condition = (CONDITIONS as readonly unknown[]).includes(data.condition) ? (data.condition as Condition) : undefined;
  return {
    docId,
    cardId: catalog ? catalogIdOf(docId, lang) : null,
    catalog,
    setId: typeof data.setId === 'string' ? data.setId : '',
    lang,
    count: typeof data.count === 'number' ? data.count : 1,
    ...(variant ? { variant } : {}),
    ...(condition ? { condition } : {}),
    printed,
    addedAt: (data.addedAt as Timestamp | undefined) ?? null,
    updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
  };
}

/** Группа в альбоме: сет каталога или код сета, напечатанный на карте вне базы. */
export function setKey(card: Pick<OwnedCard, 'catalog' | 'setId' | 'lang'>): string {
  return card.catalog ? `${card.catalog}:${card.setId}` : `x:${card.lang}:${card.setId}`;
}

const slug = (value: string) =>
  value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

/** Короткий отпечаток имени (FNV-1a), если на карте не прочитан код сета. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value.normalize('NFKC').toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Карта вне базы: ID документа из языка, кода сета и номера, чтобы повторный скан той же
 * карты добавил копию, а не новую запись. «x-» не встречается в ID карт TCGdex.
 */
export function customCard(lang: CardLanguage, printed: PrintedCard): { docId: string; setId: string } {
  const set = printed.setCode ? slug(printed.setCode).slice(0, 20) : '';
  const number = slug(normalizeNumber(printed.number)) || '0';
  const key = set ? `${set}-${number}` : `${fingerprint(printed.englishName ?? printed.name)}-${number}`;
  return { docId: `x-${lang}-${key}`.slice(0, 60), setId: set || 'NOSET' };
}

export type NewCard = { docId: string; setId: string; lang: CardLanguage; variant?: Variant; printed?: PrintedCard };

/** Добавляет карты одной записью: новые создаются, у известных растёт счётчик. */
export async function addToCollection(
  db: Firestore,
  uid: string,
  items: NewCard[],
  owned: ReadonlyMap<string, OwnedCard>,
): Promise<void> {
  const grouped = new Map<string, NewCard & { copies: number }>();
  for (const item of items) {
    const previous = grouped.get(item.docId);
    grouped.set(item.docId, { ...item, copies: (previous?.copies ?? 0) + 1 });
  }
  const batch = writeBatch(db);
  for (const { docId, setId, lang, variant, printed, copies } of grouped.values()) {
    const ref = doc(cardsOf(db, uid), docId);
    if (owned.has(docId)) {
      batch.update(ref, { count: increment(copies), updatedAt: serverTimestamp() });
    } else {
      batch.set(ref, {
        setId,
        count: copies,
        lang,
        ...(variant ? { variant } : {}),
        ...(printed ? { printed } : {}),
        addedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }
  await batch.commit();
}

/** Ещё одна копия карты, которая уже есть в альбоме. */
export async function addOne(db: Firestore, uid: string, docId: string): Promise<void> {
  await updateDoc(doc(cardsOf(db, uid), docId), { count: increment(1), updatedAt: serverTimestamp() });
}

/** Состояние карты: хранится только у карт хуже Near Mint, у Near Mint поле убирается. */
export async function setCondition(db: Firestore, uid: string, docId: string, condition: Condition): Promise<void> {
  await updateDoc(doc(cardsOf(db, uid), docId), {
    condition: condition === 'NM' ? deleteField() : condition,
    updatedAt: serverTimestamp(),
  });
}

export type Owner = { uid: string; name: string; photoURL: string | null; count: number };

/**
 * У кого из клуба есть эта карта: одно чтение списка участников и по одному на альбом.
 * Клуб маленький, так дешевле индекса по всем альбомам.
 */
export async function friendsWithCard(db: Firestore, myUid: string, docId: string): Promise<Owner[]> {
  const members = await getDocs(collection(db, 'members'));
  const owners = await Promise.all(
    members.docs
      .filter((member) => member.id !== myUid)
      .map(async (member): Promise<Owner | null> => {
        const card = await getDoc(doc(db, 'members', member.id, 'cards', docId)).catch(() => null);
        if (!card?.exists()) return null;
        const data = member.data();
        return {
          uid: member.id,
          name: typeof data.displayName === 'string' ? data.displayName : 'Участник',
          photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
          count: typeof card.data().count === 'number' ? (card.data().count as number) : 1,
        };
      }),
  );
  return owners.filter((owner): owner is Owner => owner !== null);
}

/** Убирает одну копию; вместе с последней копией карта уходит из альбома. */
export async function removeOne(
  db: Firestore,
  uid: string,
  card: Pick<OwnedCard, 'docId' | 'count'>,
): Promise<'decremented' | 'deleted'> {
  const ref = doc(cardsOf(db, uid), card.docId);
  if (card.count > 1) {
    await updateDoc(ref, { count: increment(-1), updatedAt: serverTimestamp() });
    return 'decremented';
  }
  await deleteDoc(ref);
  return 'deleted';
}
