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
  /** Каталог TCGdex, из которого карта */
  lang: TcgdexLanguage;
  /** Не та же карта, а похожая: другой номер или английский аналог карты, которой нет в базе */
  approximate: boolean;
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

const MECHANICS = /\s+(?:ex|gx|v|vmax|vstar|v-union|break|lv\.?\s?x|prime|legend|star|δ|◇|☆)$/i;

/** Имя для поиска: английское, без механик вроде «ex» и «VMAX» на конце. */
export function searchName(card: Pick<DetectedCard, 'name' | 'englishName'>): string {
  let name = (card.englishName ?? card.name).trim();
  for (let i = 0; i < 2; i++) name = name.replace(MECHANICS, '');
  return name.trim();
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
    .replace(/[^a-z0-9]/g, '');
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

/** Совпадает ли номер карты с прочитанным, без учёта ведущих нулей. */
export function sameNumber(a: string, b: string): boolean {
  return normalizeNumber(a) === normalizeNumber(b);
}

/**
 * Оценка кандидата: имя важнее всего, совпадение общего числа карт и кода сета добавляют уверенности.
 * На японских картах напечатан сам ID сета («M2a»), на английских — сокращение («OBF»).
 */
export function scoreCandidate(detected: DetectedCard, candidate: Omit<Candidate, 'score'>): number {
  const wanted = detected.englishName ?? detected.name;
  let score = 0.6 * Math.max(nameSimilarity(wanted, candidate.name), nameSimilarity(detected.name, candidate.name));
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
