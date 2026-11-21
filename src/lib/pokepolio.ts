import { cached } from '@/lib/kv-cache';
import { namesMatch, normalizeNumber } from '@/lib/matching';

/**
 * Цены корейских карт из pokepolio (https://www.pokepolio.com): сайт собирает сделки
 * с корейскими (한글판) картами на корейских площадках (번개장터, 중고나라, кафе Naver)
 * и показывает их в вонах. Их API — по договору о данных, а страница сета отдаёт карты
 * с номером, редкостью и ценой последней сделки обычным HTML без ключа. robots.txt закрывает
 * только /api/, /my/, /admin/, /go/; Cloudflare и проверки на бота нет (проверено 21 ноября 2026).
 * CORS нет, поэтому у расширения есть host_permissions на https://www.pokepolio.com/*.
 * Разбор HTML может сломаться, если вёрстка поменяется: тогда цен у корейских карт просто нет.
 *
 * Сеты у них со своими ID (UUID). Код сета виден по сканам карт официального сайта
 * («…/wmimages/MEGA/M2a/…») в блоке сета на странице списка /cards-list?page=N (по 8 сетов,
 * 22 страницы); у части сетов сканы с другого сайта, тогда сет узнаётся по корейскому названию.
 */

const SITE = 'https://www.pokepolio.com';
const DAY = 24 * 60 * 60 * 1000;
const VERSION = 1;

/** Сет pokepolio: UUID, код сета (если виден по сканам) и корейское название товара. */
export type PokepolioSet = { uuid: string; code: string | null; name: string };

/** Карта на странице сета: цена — последняя сделка без грейда в вонах (null — сделок нет или только в грейде). */
export type PokepolioCard = { uuid: string; name: string; number: string; total: string | null; rarity: string | null; krw: number | null; mirror: boolean };

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/<!-- -->/g, '')
    .trim();
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let seen = 0;
  for (const [value, count] of counts) if (count > seen) [best, seen] = [value, count];
  return best;
}

/** Код сета из адреса скана официального сайта (как есть или внутри ?src=…). */
function codesIn(html: string): string[] {
  const decoded = html.replace(/%2F/gi, '/');
  return [...decoded.matchAll(/wmimages\/[A-Za-z0-9]+\/([A-Za-z0-9._-]{1,30})\//g)].map((match) => match[1]!);
}

/** Страница списка сетов: блоки «pack-section» и число страниц («1 / 22»). */
export function parsePokepolioList(html: string): { sets: PokepolioSet[]; pages: number } {
  const end = html.indexOf('class="pagination"');
  const body = end > 0 ? html.slice(0, end) : html;
  const sets: PokepolioSet[] = [];
  for (const part of body.split('class="pack-section"').slice(1)) {
    const uuid = part.match(/href="\/sets\/([0-9a-f-]{36})"/)?.[1];
    if (!uuid || sets.some((set) => set.uuid === uuid)) continue;
    const name = decodeHtml(part.match(/<img[^>]*\balt="([^"]*)"/)?.[1] ?? '');
    sets.push({ uuid, code: mostCommon(codesIn(part)), name });
  }
  const pages = Number(html.slice(Math.max(0, end)).match(/<span>\s*\d+\s*(?:<!-- -->)?\s*\/\s*(?:<!-- -->)?\s*(\d+)\s*<\/span>/)?.[1] ?? 1);
  return { sets, pages: Number.isFinite(pages) && pages > 0 ? Math.min(pages, 60) : 1 };
}

function won(value: string): number | null {
  const match = value.match(/([\d,]+)\s*원/);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Страница сета: карты с номером и ценой. Цена берётся, только если сделка без грейда («Raw»). */
export function parsePokepolioSet(html: string): PokepolioCard[] {
  const cards: PokepolioCard[] = [];
  for (const match of html.matchAll(/<a class="card-grid-item" href="\/cards\/([0-9a-f-]{36})">([\s\S]*?)<\/a>/g)) {
    const [, uuid, block] = match as unknown as [string, string, string];
    const name = decodeHtml(block.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? '');
    const line = decodeHtml(block.match(/<span>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const [numbering = '', rarity] = line.split('·').map((part) => part.trim());
    const [number = '', total] = numbering.split('/').map((part) => part.trim());
    if (!name || !number) continue;
    const price = block.match(/class="card-grid-price"[^>]*>([\s\S]*?)<\/em>/)?.[1] ?? '';
    const source = decodeHtml(block.match(/class="card-grid-source"[^>]*>([\s\S]*?)<\/small>/)?.[1] ?? '');
    const image = block.match(/<img[^>]*\bsrc="([^"]*)"/)?.[1] ?? '';
    cards.push({
      uuid,
      name,
      number,
      total: total ?? null,
      rarity: rarity || null,
      krw: /^Raw\b/i.test(source) ? won(decodeHtml(price)) : null,
      mirror: /_m\.(?:png|webp)|_m%2E|_m(?:%3F|\?|\.)/i.test(image),
    });
  }
  return cards;
}

async function page(path: string): Promise<string> {
  const response = await fetch(`${SITE}${path}`);
  if (!response.ok) throw new Error(`pokepolio ${response.status}`);
  return response.text();
}

/** Все сеты pokepolio: страницы списка по очереди, раз в неделю. */
export function pokepolioSets(): Promise<PokepolioSet[]> {
  return cached(`pokepolio:sets:v${VERSION}`, 7 * DAY, async () => {
    const first = parsePokepolioList(await page('/cards-list'));
    const sets = [...first.sets];
    for (let index = 2; index <= first.pages; index++) {
      for (const set of parsePokepolioList(await page(`/cards-list?page=${index}`)).sets) {
        if (!sets.some((item) => item.uuid === set.uuid)) sets.push(set);
      }
    }
    if (sets.length === 0) throw new Error('pokepolio: сетов нет');
    return sets;
  });
}

const plainName = (value: string) => value.normalize('NFKC').replace(/[\s「」『』"'·]/g, '').toLowerCase();

/** Сет pokepolio для нашего сета: по коду, а если код не виден — по корейскому названию. */
export function pokepolioSetFor(sets: PokepolioSet[], setCode: string, setName: string | null): PokepolioSet | null {
  const code = setCode.trim().toUpperCase();
  const byCode = sets.filter((set) => set.code?.toUpperCase() === code);
  if (byCode.length === 1) return byCode[0]!;
  if (!setName) return null;
  const wanted = plainName(setName);
  return sets.find((set) => set.code === null && plainName(set.name) === wanted) ?? byCode[0] ?? null;
}

/** Карты сета pokepolio. Страница до 1 МБ, поэтому её содержимое хранится сутки. */
export function fetchPokepolioSet(uuid: string): Promise<PokepolioCard[]> {
  return cached(`pokepolio:set:v${VERSION}:${uuid}`, DAY, async () => parsePokepolioSet(await page(`/sets/${uuid}`)));
}

/** Наша карта на странице сета: тот же номер и то же имя (корейское), обычная печать раньше зеркальной. */
export function matchPokepolio(cards: PokepolioCard[], card: { localId: string; name: string }): PokepolioCard | null {
  const number = normalizeNumber(card.localId);
  const same = cards.filter((item) => normalizeNumber(item.number) === number && namesMatch(item.name, card.name) >= 0.8);
  return same.find((item) => !item.mirror) ?? same[0] ?? null;
}
