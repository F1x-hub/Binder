/**
 * Сопоставление того, что прочитала модель, с картами из базы. Модели не доверяем
 * «придумывать» карту: номер и сет всегда сверяются с TCGdex, а при сомнениях
 * человеку показываются 2–3 варианта.
 */

import type { CardLanguage, TcgdexLanguage } from '@/lib/languages';

/** Рамка карты на фото в долях от размеров снимка: [слева, сверху, ширина, высота]. */
export type Box = [number, number, number, number];

/** То, что модель прочитала с одной карты на фото. */
export type DetectedCard = {
  name: string;
  englishName: string | null;
  number: string;
  total: string | null;
  setCode: string | null;
  holo: boolean | null;
  language: CardLanguage;
  box: Box | null;
  confidence: number;
};

/** Карта из базы, похожая на прочитанную. */
export type Candidate = {
  cardId: string;
  setId: string;
  name: string;
  localId: string;
  image?: string;
  setName: string;
  printedTotal: number | null;
  setCode: string | null;
  releaseDate: string | null;
  /** Каталог TCGdex, из которого карта (у карт из Limitless — язык карты) */
  lang: TcgdexLanguage;
  /** Не та же карта, а похожая: язык карты не определён, и это подсказка из английской базы */
  approximate: boolean;
  /** Откуда карта: TCGdex или Limitless TCG (японские карты, которых нет в TCGdex) */
  source: 'tcgdex' | 'limitless';
  /** Английское имя японской карты из Limitless */
  englishName?: string | null;
  score: number;
};

export type Decision =
  | { status: 'ready'; pick: Candidate }
  | { status: 'choose'; options: Candidate[] }
  | { status: 'not-found' };

/** Номер без ведущих нулей и в верхнем регистре: «057» → «57», «tg05» → «TG05». */
export function normalizeNumber(value: string): string {
  return value.trim().toUpperCase().replace(/^0+(?=\d)/, '');
}

/** Варианты записи номера для поиска: в одних сетах «057», в других «57». */
export function localIdVariants(number: string): string[] {
  const trimmed = number.trim().toUpperCase();
  if (!/^\d+$/.test(trimmed)) return [trimmed];
  const bare = normalizeNumber(trimmed);
  return [...new Set([trimmed, bare, bare.padStart(3, '0')])];
}

/**
 * Механики на конце имени. В латинских именах перед ними пробел или дефис («Charizard ex»,
 * «M Gengar-EX»), в японских пробела нет («リザードンex»); у «Pokédex» ничего не отрезается.
 */
const MECHANICS = /(?:[\s-]+|(?<=[^\s\x00-\x7F]))(?:ex|gx|v|vmax|vstar|v-union|break|lv\.?\s?x|prime|legend|star|δ|◇|☆)$/i;

/** Имя для поиска без механик вроде «ex» и «VMAX» на конце. Полноширинные буквы приводятся к обычным. */
export function searchName(name: string): string {
  let result = name.normalize('NFKC').trim();
  for (let i = 0; i < 2; i++) result = result.replace(MECHANICS, '').trim();
  return result;
}

/** Последнее слово имени: запасной поиск, если полное имя прочитано с ошибкой. */
export function lastWord(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length >= 3);
  return words[words.length - 1] ?? name;
}

function simplify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // убираем диакритику: «Pokémon» → «pokemon»
    .replace(/[^\p{L}\p{N}]/gu, ''); // буквы любых алфавитов остаются: японские имена тоже сравниваются
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/** Похожесть имён от 0 до 1 без учёта регистра, пробелов и знаков. */
export function nameSimilarity(a: string, b: string): number {
  const left = simplify(a);
  const right = simplify(b);
  if (!left || !right) return 0;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

type Script = 'latin' | 'cjk' | 'hangul' | 'thai' | 'cyrillic' | 'none';

/** Письменность имени: японские имена с «ex» на конце — всё равно японские. */
export function scriptOf(name: string): Script {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name)) return 'cjk';
  if (/\p{Script=Hangul}/u.test(name)) return 'hangul';
  if (/\p{Script=Thai}/u.test(name)) return 'thai';
  if (/\p{Script=Cyrillic}/u.test(name)) return 'cyrillic';
  if (/\p{Script=Latin}/u.test(name)) return 'latin';
  return 'none';
}

/** Сам покемон или предмет: без «Mega»/«M»/«メガ» в начале и без механик в конце. */
export function coreName(name: string): string {
  return searchName(name)
    .replace(/^(?:mega|m)\s+/i, '')
    .replace(/^メガ/, '')
    .trim();
}

/**
 * Совпадение имён: меньшее из похожести целиком и похожести без «Mega» и «ex».
 * Иначе «Mega Gengar ex» и «Mega Venusaur ex» похожи на 0.71 только за счёт общих частей.
 */
export function namesMatch(a: string, b: string): number {
  return Math.min(nameSimilarity(a, b), nameSimilarity(coreName(a), coreName(b)));
}

/** Карта из базы для сверки имени: имя, язык каталога и английское имя, если база его знает. */
export type NamedCard = { name: string; lang: string; englishName?: string | null };

/**
 * Насколько имя карты из базы совпадает с прочитанным; null — сравнить нечего.
 * Напечатанное имя надёжнее английского: если карта и база на одном языке, решает оно,
 * и японская «メガゲンガーex» не спутается с «メガフシギバナex», как бы ни были похожи английские имена.
 * Иначе (французская карта и английская база, японское имя прочитано латиницей) сравниваются английские имена.
 */
export function nameVerdict(detected: Pick<DetectedCard, 'name' | 'englishName' | 'language'>, card: NamedCard): number | null {
  if (detected.language === card.lang && scriptOf(detected.name) === scriptOf(card.name)) {
    return namesMatch(detected.name, card.name);
  }
  const ours = detected.englishName ?? (scriptOf(detected.name) === 'latin' ? detected.name : null);
  const theirs = card.englishName ?? (scriptOf(card.name) === 'latin' ? card.name : null);
  return ours && theirs ? namesMatch(ours, theirs) : null;
}

/** Похожесть имени для оценки: если сравнить нечего, имя ничего не добавляет. */
export function nameScore(detected: Pick<DetectedCard, 'name' | 'englishName' | 'language'>, card: NamedCard): number {
  return nameVerdict(detected, card) ?? 0;
}

/** Ниже этого имя явно другое: карта с тем же номером, но чужая. */
export const NAME_FLOOR = 0.5;

/** Совпадает ли номер карты с прочитанным, без учёта ведущих нулей. */
export function sameNumber(a: string, b: string): boolean {
  return normalizeNumber(a) === normalizeNumber(b);
}

/**
 * Оценка кандидата: имя важнее всего, совпадение общего числа карт и кода сета добавляют уверенности.
 * На японских картах напечатан сам ID сета («M2a»), на английских — сокращение («OBF»).
 */
export function scoreCandidate(detected: DetectedCard, candidate: Omit<Candidate, 'score'>): number {
  let score = 0.6 * nameScore(detected, candidate);
  if (detected.total && candidate.printedTotal !== null && normalizeNumber(detected.total) === String(candidate.printedTotal)) {
    score += 0.3;
  }
  const code = detected.setCode?.trim().toUpperCase();
  if (code && (candidate.setCode?.toUpperCase() === code || candidate.setId.toUpperCase() === code)) {
    score += 0.1;
  }
  return Math.round(score * 1000) / 1000;
}

/** Порог, с которого карта считается узнанной без вопросов. */
export const READY_SCORE = 0.82;

/**
 * Узнана, если лучший кандидат набрал порог, заметно опережает второго и это именно
 * та карта, а не похожая. Иначе до трёх вариантов на выбор.
 */
export function decide(candidates: Candidate[]): Decision {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const [best, second] = sorted;
  if (!best) return { status: 'not-found' };
  if (!best.approximate && best.score >= READY_SCORE && (!second || best.score - second.score >= 0.12)) {
    return { status: 'ready', pick: best };
  }
  return { status: 'choose', options: sorted.slice(0, 3) };
}
