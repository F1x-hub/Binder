import { nameSimilarity } from '@/lib/matching';

/**
 * Имя карты для показа: английское — главным, если оно известно и отличается от напечатанного
 * (японская «メガゲンガーex» показывается как «Mega Gengar ex»), напечатанное — вторым.
 * У английских карт и международных изданий из английской базы имя одно.
 */
export function displayNames(original: string, english: string | null | undefined): { primary: string; secondary: string | null } {
  if (english && english.trim() && nameSimilarity(english, original) < 0.9) return { primary: english.trim(), secondary: original };
  return { primary: original, secondary: null };
}
