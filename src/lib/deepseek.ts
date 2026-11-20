import { browser } from 'wxt/browser';
import type { DetectedCard } from '@/lib/matching';

/**
 * Распознавание карт моделью DeepSeek. Ключ вводит сам пользователь, он хранится
 * только в chrome.storage.local этого браузера и никуда больше не уходит.
 * Модель deepseek-flash (DeepSeek-V4.1-Flash) принимает картинки и умеет отвечать строго JSON.
 */
const API = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-flash';
const KEY_STORAGE = 'deepseekKey';

export async function loadDeepseekKey(): Promise<string> {
  const stored: unknown = (await browser.storage.local.get(KEY_STORAGE))[KEY_STORAGE];
  return typeof stored === 'string' ? stored : '';
}

export async function saveDeepseekKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await browser.storage.local.set({ [KEY_STORAGE]: trimmed });
  else await browser.storage.local.remove(KEY_STORAGE);
}

export type KeyStatus = 'ok' | 'invalid' | 'no-model' | 'offline';

/** Проверка ключа без трат: список моделей бесплатный. */
export async function checkDeepseekKey(key: string): Promise<KeyStatus> {
  let response: Response;
  try {
    response = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${key.trim()}` } });
  } catch {
    return 'offline';
  }
  if (response.status === 401 || response.status === 403) return 'invalid';
  if (!response.ok) return 'offline';
  const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
  return body?.data?.some((model) => model.id === DEEPSEEK_MODEL) ? 'ok' : 'no-model';
}

export type RecognizeFailure = 'invalid-key' | 'no-balance' | 'rate-limit' | 'failed' | 'offline';

export class RecognizeError extends Error {
  readonly reason: RecognizeFailure;

  constructor(reason: RecognizeFailure) {
    super(reason);
    this.name = 'RecognizeError';
    this.reason = reason;
  }
}

const SYSTEM_PROMPT = `You read Pokémon Trading Card Game cards in photos.
For every card that is clearly visible, return what is printed on it.
Reply with JSON only, in this shape:
{"cards":[{"name":"","englishName":"","number":"","total":"","setCode":"","holo":false,"confidence":0}]}
Rules:
- name: the card name exactly as printed, with suffixes like ex, V, VMAX, VSTAR, GX.
- englishName: the official English name of the card. If the card is in English, repeat name.
- number: the collector number before the slash, exactly as printed, keeping leading zeros and letters ("057", "TG05").
- total: the number after the slash exactly as printed, or null if there is no slash.
- setCode: the 2-4 letter set abbreviation printed next to the number (for example "OBF"), or null.
- holo: true for holographic or reverse holo cards, false for regular ones, null if unsure.
- confidence: from 0 to 1, how sure you are that both name and number are right.
Never guess a number you cannot read: lower the confidence instead.
If no card is visible, reply {"cards":[]}.`;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Разбор ответа модели. Всё сомнительное отбрасывается, а не угадывается. */
export function parseRecognition(content: string): DetectedCard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const list = (parsed as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 20)
    .map((item): DetectedCard | null => {
      const raw = (item ?? {}) as Record<string, unknown>;
      const name = text(raw.name);
      const number = text(raw.number)?.replace(/\s+/g, '') ?? null;
      if (!name || !number) return null;
      const confidence = typeof raw.confidence === 'number' ? Math.min(Math.max(raw.confidence, 0), 1) : 0.5;
      return {
        name,
        englishName: text(raw.englishName),
        number,
        total: text(raw.total)?.replace(/\s+/g, '') ?? null,
        setCode: text(raw.setCode),
        holo: typeof raw.holo === 'boolean' ? raw.holo : null,
        confidence,
      };
    })
    .filter((card): card is DetectedCard => card !== null);
}

/** Карты на одном фото. imageDataUrl — JPEG в base64 (src/lib/photo.ts). */
export async function recognizeCards(key: string, imageDataUrl: string): Promise<DetectedCard[]> {
  let response: Response;
  try {
    response = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the Pokémon cards in this photo and reply with JSON.' },
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new RecognizeError('offline');
  }
  if (response.status === 401 || response.status === 403) throw new RecognizeError('invalid-key');
  if (response.status === 402) throw new RecognizeError('no-balance');
  if (response.status === 429) throw new RecognizeError('rate-limit');
  if (!response.ok) throw new RecognizeError('failed');
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return parseRecognition(body.choices?.[0]?.message?.content ?? '');
}

export function recognizeErrorMessage(error: unknown): string {
  if (error instanceof RecognizeError) {
    switch (error.reason) {
      case 'invalid-key':
        return 'Ключ DeepSeek не подошёл. Проверь его в настройках.';
      case 'no-balance':
        return 'На счёте DeepSeek закончились деньги.';
      case 'rate-limit':
        return 'DeepSeek просит подождать. Попробуй через минуту.';
      case 'offline':
        return 'Нет связи с DeepSeek. Проверь интернет.';
      case 'failed':
        return 'DeepSeek не смог разобрать фото. Попробуй ещё раз.';
    }
  }
  return 'Не получилось распознать фото.';
}
