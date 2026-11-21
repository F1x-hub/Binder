import { cached } from '@/lib/kv-cache';
import { NAME_FLOOR, nameVerdict, sameNumber, searchName, type Candidate, type DetectedCard } from '@/lib/matching';

/**
 * Официальная база карт для Тайваня и Гонконга (традиционные иероглифы) — сайт Pokémon Asia:
 * https://asia.pokemon-card.com/tw/card-search/. TCGdex знает тайваньские сеты, но многие
 * пустые, а в остальных скан есть только у первых 20 карт сета (проверено 21 ноября 2026).
 * Здесь же карты есть в день выхода сета, со сканом во весь размер (PNG около 1,6 МБ).
 *
 * Сайт на Apache, без Cloudflare и без проверки на бота, но и без CORS: у расширения есть
 * host_permissions на https://asia.pokemon-card.com/* (wxt.config.ts). API нет, читаем HTML:
 * поиск отдаёт ссылки на карты (/tw/card-search/detail/{N}/) и сканы (/tw/card-img/tw{N}.png),
 * страница карты — имя (в <title>), номер (collectorNumber) и код сета (ссылка expansionCodes=…).
 * Коды сетов те же, что у японских карт и в каталоге TCGdex: «SV2a», «M6a».
 */

const SITE = 'https://asia.pokemon-card.com';
const DAY = 24 * 60 * 60 * 1000;

/** Карта с официального сайта. */
export type TwCard = { detailId: number; name: string; number: string; total: string | null; setCode: string | null; image: string };

/** Адрес скана по номеру карты на сайте: 8124 → …/tw/card-img/tw00008124.png. */
export function twImage(detailId: number): string {
  return `${SITE}/tw/card-img/tw${String(detailId).padStart(8, '0')}.png`;
}

/** ID карт со страницы поиска, по порядку и без повторов. */
export function detailIdsFrom(html: string): number[] {
  return [...new Set([...html.matchAll(/\/tw\/card-search\/detail\/(\d+)\//g)].map((match) => Number(match[1])))];
}

const decode = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Карта со страницы карты; null — страница не той формы. */
export function twCardFrom(detailId: number, html: string): TwCard | null {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1];
  const name = title ? decode(title.split('|')[0] ?? '') : '';
  const printed = html.match(/class="collectorNumber">\s*([^<]+?)\s*</)?.[1]?.trim();
  if (!name || !printed) return null;
  const [number, total] = printed.split('/').map((part) => part.trim());
  const setCode = html.match(/card-search\/list\/\?expansionCodes=([A-Za-z0-9._-]+)/)?.[1] ?? null;
  return { detailId, name, number: number ?? printed, total: total || null, setCode, image: twImage(detailId) };
}

async function page(path: string): Promise<string> {
  const response = await fetch(`${SITE}${path}`);
  if (!response.ok) throw new Error(`asia.pokemon-card.com ответил ${response.status}`);
  return response.text();
}

/** Карта по номеру на сайте, с кэшем на 30 дней: карты на сайте не меняются. */
export function twCard(detailId: number): Promise<TwCard | null> {
  return cached(`asia:tw:card:${detailId}`, 30 * DAY, async () => twCardFrom(detailId, await page(`/tw/card-search/detail/${detailId}/`)));
}

/**
 * Поиск по имени, а если известен код сета — внутри сета. Первая страница выдачи — до 20 карт:
 * имя вместе с сетом почти всегда даёт одну-три карты. Кэш на неделю: новые сеты приходят редко.
 */
export function searchTw(keyword: string, setCode: string | null): Promise<number[]> {
  const query = new URLSearchParams({ keyword });
  if (setCode) query.set('expansionCodes', setCode);
  return cached(`asia:tw:search:${setCode ?? ''}:${keyword}`, 7 * DAY, async () =>
    detailIdsFrom(await page(`/tw/card-search/list/?${query.toString()}`)),
  );
}

/**
 * Карта под этим кодом сета, номером и именем. Имя должно совпасть: при неверно прочитанном
 * коде сета под тем же номером нашлась бы чужая карта. Смотрим не больше шести карт выдачи.
 */
export async function findTwCard(wanted: { name: string; number: string; setCode: string | null }): Promise<TwCard | null> {
  const keyword = searchName(wanted.name);
  if (keyword.length < 1) return null;
  const ids = await searchTw(keyword, wanted.setCode);
  for (const id of ids.slice(0, 6)) {
    const card = await twCard(id).catch(() => null);
    if (!card || !sameNumber(card.number, wanted.number)) continue;
    if (wanted.setCode && card.setCode && card.setCode.toUpperCase() !== wanted.setCode.toUpperCase()) continue;
    const verdict = nameVerdict({ name: wanted.name, englishName: null, language: 'zh-tw' }, { name: card.name, lang: 'zh-tw' });
    if (verdict !== null && verdict >= 0.8) return card;
  }
  return null;
}

/**
 * Тайваньская карта, которой нет в TCGdex, как кандидат сканера: по коду сета и номеру,
 * а без кода — по имени и номеру во всей базе. Номер совпадает по построению, решает имя.
 * В альбом такая карта идёт как есть, с именем и кодом сета с сайта (src/scan/useScan.ts).
 */
export async function searchTwCandidates(detected: DetectedCard): Promise<Candidate[]> {
  const keyword = searchName(detected.name);
  if (!keyword) return [];
  const codes = [...new Set([detected.setCode?.trim() || null, null])];
  for (const code of codes) {
    const ids = await searchTw(keyword, code);
    const found: Candidate[] = [];
    for (const id of ids.slice(0, 6)) {
      const card = await twCard(id).catch(() => null);
      if (!card || !sameNumber(card.number, detected.number)) continue;
      const verdict = nameVerdict(detected, { name: card.name, lang: 'zh-tw' });
      if (verdict === null || verdict < NAME_FLOOR) continue;
      const setCode = card.setCode ?? code ?? '';
      const sameTotal = Boolean(detected.total && card.total && sameNumber(detected.total, card.total));
      const sameCode = Boolean(detected.setCode && setCode && detected.setCode.trim().toUpperCase() === setCode.toUpperCase());
      found.push({
        cardId: `tw:${card.detailId}`,
        setId: setCode,
        name: card.name,
        localId: card.number,
        image: card.image,
        setName: setCode || 'Без сета',
        printedTotal: card.total && /^\d+$/.test(card.total) ? Number(card.total) : null,
        setCode: setCode || null,
        releaseDate: null,
        lang: 'zh-tw',
        approximate: false,
        source: 'asia',
        score: Math.round((0.6 * verdict + (sameTotal ? 0.3 : 0) + (sameCode ? 0.1 : 0)) * 1000) / 1000,
      });
    }
    if (found.length > 0) return found;
  }
  return [];
}
