import { CONDITIONS, type Condition } from '@/lib/collection';
import { askVision, type VisionPart } from '@/lib/deepseek';

/**
 * Оценка состояния карты моделью DeepSeek по нескольким фото с разных ракурсов, по шкале
 * TCGplayer (NM, LP, MP, HP, DMG). Фото нужны только для оценки и нигде не сохраняются.
 * Если фото не хватает, модель говорит, какие ракурсы снять ещё.
 */
export const PHOTO_KINDS = ['front', 'back', 'angled', 'corners'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Что снять: обязательные — лицо, рубашка и лицо под углом к свету, углы крупно — по желанию. */
export const PHOTO_SLOTS: Record<PhotoKind, { title: string; hint: string; required: boolean; prompt: string }> = {
  front: { title: 'Лицевая сторона', hint: 'прямо, вся карта в кадре', required: true, prompt: 'front, straight on' },
  back: { title: 'Рубашка', hint: 'прямо, вся карта в кадре', required: true, prompt: 'back, straight on' },
  angled: {
    title: 'Лицевая под углом',
    hint: 'к лампе или окну, чтобы блики показали царапины и вмятины',
    required: true,
    prompt: 'front at an angle under light, to reveal scratches, scuffs and dents',
  },
  corners: { title: 'Углы крупно', hint: 'по желанию: самый потёртый угол или край', required: false, prompt: 'close-up of corners or edges' },
};

export type GradeAspects = { corners: string | null; edges: string | null; surface: string | null; centering: string | null };

export type Grade = {
  condition: Condition;
  confidence: number;
  aspects: GradeAspects;
  summary: string | null;
  /** Каких ракурсов не хватило для уверенной оценки */
  missing: PhotoKind[];
  /** false — на фото разные карты */
  sameCard: boolean;
};

const SYSTEM_PROMPT = `You grade the physical condition of one Pokémon Trading Card Game card from several photos, using the TCGplayer condition scale:
- NM (Near Mint): looks fresh from the pack; at most a few tiny white specks on the edges; no scratches, scuffs, dents or creases.
- LP (Lightly Played): minor wear on edges or corners, light scratches or small scuffs; no creases.
- MP (Moderately Played): noticeable wear on edges and corners, clear scratches or scuffs, minor dents or a small crease.
- HP (Heavily Played): heavy wear, creases or bends, strong whitening, many scratches.
- DMG (Damaged): tears, water damage, deep creases, writing, missing pieces.
Each photo is labelled with its view. Look at corners, edges, surface (use the angled photo for scratches) and centering.
Reply with JSON only, in this shape:
{"condition":"NM","confidence":0,"aspects":{"corners":"","edges":"","surface":"","centering":""},"summary":"","missing":[],"sameCard":true}
Rules:
- Write aspects and summary in Russian, short, at most 120 characters each.
- When unsure between two grades, choose the lower one.
- If a photo is blurry, too dark, cropped, or the card is in a sleeve or toploader, say so in summary and lower confidence.
- missing: views you still need for a reliable grade, from "front", "back", "angled", "corners"; empty if the photos are enough.
- sameCard: false if the photos show different cards.
- confidence: from 0 to 1.`;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

/** Разбор ответа модели. Без понятного состояния оценки нет. */
export function parseGrade(content: string): Grade | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const condition = typeof raw.condition === 'string' ? raw.condition.trim().toUpperCase() : '';
  if (!(CONDITIONS as readonly string[]).includes(condition)) return null;
  const aspects = (raw.aspects ?? {}) as Record<string, unknown>;
  const missing = Array.isArray(raw.missing)
    ? raw.missing.filter((item): item is PhotoKind => (PHOTO_KINDS as readonly unknown[]).includes(item))
    : [];
  return {
    condition: condition as Condition,
    confidence: typeof raw.confidence === 'number' ? Math.min(Math.max(raw.confidence, 0), 1) : 0.5,
    aspects: {
      corners: text(aspects.corners),
      edges: text(aspects.edges),
      surface: text(aspects.surface),
      centering: text(aspects.centering),
    },
    summary: text(raw.summary),
    missing: [...new Set(missing)],
    sameCard: raw.sameCard !== false,
  };
}

export type GradePhoto = { kind: PhotoKind; dataUrl: string };

/** Оценка состояния по фото, подписанным ракурсами. Ошибки — RecognizeError, как у сканера. */
export async function gradeCondition(key: string, cardName: string, photos: GradePhoto[]): Promise<Grade | null> {
  const parts: VisionPart[] = [{ type: 'text', text: `Card: ${cardName}. Grade its condition from these photos and reply with JSON.` }];
  photos.forEach((photo, index) => {
    parts.push({ type: 'text', text: `Photo ${index + 1}: ${PHOTO_SLOTS[photo.kind].prompt}.` });
    parts.push({ type: 'image_url', image_url: { url: photo.dataUrl, detail: 'high' } });
  });
  return parseGrade(await askVision(key, SYSTEM_PROMPT, parts, 900));
}
