import { cached } from '@/lib/kv-cache';
import {
  lastWord,
  localIdVariants,
  normalizeNumber,
  scoreCandidate,
  searchName,
  type Candidate,
  type DetectedCard,
} from '@/lib/matching';
import {
  isPocketCard,
  isPocketId,
  setIdOf,
  tcgdexApi,
  type CardBrief,
  type CardDetail,
  type SetBrief,
  type SetDetail,
} from '@/lib/tcgdex';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Справочник карт поверх TCGdex с кэшем в IndexedDB. В Firestore справочник не храним:
 * это экономит десятки тысяч записей при заливке и чтения при каждом скане.
 */
export const catalog = {
  sets: (): Promise<SetBrief[]> => cached('tcgdex:sets', 7 * DAY, tcgdexApi.sets),
  set: (id: string): Promise<SetDetail> => cached(`tcgdex:set:${id}`, 7 * DAY, () => tcgdexApi.set(id)),
  card: (id: string): Promise<CardDetail> => cached(`tcgdex:card:${id}`, 30 * DAY, () => tcgdexApi.card(id)),
  search: (name: string, localId: string): Promise<CardBrief[]> =>
    cached(`tcgdex:search:${name.toLowerCase()}:${localId}`, 7 * DAY, () => tcgdexApi.search(name, localId)),
};

/** Поиск по имени и номеру: сначала полное имя, потом последнее слово, во всех записях номера. */
async function searchByName(detected: DetectedCard): Promise<CardBrief[]> {
  const full = searchName(detected);
  const names = [...new Set([full, lastWord(full)].filter((name) => name.length >= 2))];
  for (const name of names) {
    for (const localId of localIdVariants(detected.number)) {
      const found = (await catalog.search(name, localId)).filter((card) => !isPocketCard(card));
      if (found.length > 0) return found;
    }
  }
  return [];
}

/** Запасной путь: сеты с тем же числом карт, что напечатано после дроби, и номер в них. */
async function searchByTotal(detected: DetectedCard): Promise<CardBrief[]> {
  if (!detected.total || !/^\d+$/.test(detected.total.trim())) return [];
  const total = Number(normalizeNumber(detected.total));
  const sets = (await catalog.sets()).filter((set) => set.cardCount.official === total && !isPocketId(set.id));
  const number = normalizeNumber(detected.number);
  const found: CardBrief[] = [];
  for (const set of sets.slice(0, 6)) {
    const detail = await catalog.set(set.id);
    const card = detail.cards.find((item) => normalizeNumber(item.localId) === number);
    if (card) found.push(card);
  }
  return found;
}

/** Кандидаты для одной прочитанной карты, лучшие первыми. */
export async function findCandidates(detected: DetectedCard): Promise<Candidate[]> {
  let briefs = await searchByName(detected);
  if (briefs.length === 0) briefs = await searchByTotal(detected);

  const candidates = await Promise.all(
    briefs.slice(0, 8).map(async (brief) => {
      const setId = setIdOf(brief);
      const set = await catalog.set(setId).catch(() => null);
      const base = {
        cardId: brief.id,
        setId,
        name: brief.name,
        localId: brief.localId,
        image: brief.image,
        setName: set?.name ?? setId,
        printedTotal: set?.cardCount.official ?? null,
        setCode: set?.abbreviation?.official ?? null,
        releaseDate: set?.releaseDate ?? null,
      };
      return { ...base, score: scoreCandidate(detected, base) };
    }),
  );
  return candidates.sort((a, b) => b.score - a.score);
}
