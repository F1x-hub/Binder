import { browser } from 'wxt/browser';
import { languageFromScript, normalizeLanguage, type CardLanguage } from '@/lib/languages';
import type { Box, DetectedCard } from '@/lib/matching';

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
{"cards":[{"name":"","englishName":"","number":"","total":"","setCode":"","language":"","holo":false,"box":[0,0,0,0],"confidence":0}]}
Rules:
- name: the card name exactly as printed, in the card's own language and script, with suffixes like ex, V, VMAX, VSTAR, GX. Do not translate it.
- englishName: the official English name of the card. If the card is in English, repeat name.
- number: the collector number before the slash, exactly as printed, keeping leading zeros and letters ("057", "TG05").
- total: the number after the slash exactly as printed, or null if there is no slash.
- setCode: the set code printed in small letters near the bottom-left corner, next to the regulation mark letter or the number, copied exactly ("OBF", "SV2a", "M2a", "MBG", "CSV1C"). If you cannot read it clearly, return null. Never guess it from the Pokémon or from the set you think the card belongs to.
- language: the language the card text is printed in: "en", "fr", "de", "it", "es", "pt", "ru", "ja", "zh-tw" (traditional Chinese characters), "zh-cn" (simplified Chinese characters), "ko", "id", "th", or "other". Judge by the printed text, not by the Pokémon.
- holo: true for holographic or reverse holo cards, false for regular ones, null if unsure.
- box: where the card is in the photo, as [left, top, right, bottom] in thousandths of the photo width and height, from 0 to 1000.
- confidence: from 0 to 1, how sure you are that both name and number are right.
Never guess a number you cannot read: lower the confidence instead.
If no card is visible, reply {"cards":[]}.`;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Язык карты: письменность имени надёжнее ответа модели, дальше — что ответила модель. */
function languageOf(raw: unknown, name: string): CardLanguage {
  return languageFromScript(name) ?? normalizeLanguage(raw) ?? 'other';
}

/**
 * Рамка карты из ответа модели: углы в тысячных долях снимка (или в долях, если модель
 * ответила так) превращаются в [слева, сверху, ширина, высота] в долях. Кривая рамка отбрасывается.
 */
export function parseBox(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map((item) => (typeof item === 'number' ? item : Number.NaN));
  if (!numbers.every(Number.isFinite)) return null;
  const scale = Math.max(...numbers) <= 1 ? 1 : 1000;
  const [left, top, right, bottom] = numbers.map((item) => Math.min(Math.max(item / scale, 0), 1)) as Box;
  if (right - left < 0.03 || bottom - top < 0.03) return null;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return [round(left), round(top), round(right - left), round(bottom - top)];
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
        language: languageOf(raw.language, name),
        box: parseBox(raw.box),
        confidence,
      };
    })
    .filter((card): card is DetectedCard => card !== null);
}

/** Часть сообщения для модели: текст или фото (JPEG в base64 из src/lib/photo.ts). */
export type VisionPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

/**
 * Запрос к модели с фото и ответом строго в JSON: общий для сканера и оценки состояния.
 * Размышления выключены: так быстрее и дешевле, а для чтения фото их не нужно.
 */
export async function askVision(key: string, system: string, parts: VisionPart[], maxTokens: number): Promise<string> {
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
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: parts },
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
  return body.choices?.[0]?.message?.content ?? '';
}

/** Карты на одном фото. imageDataUrl — JPEG в base64 (src/lib/photo.ts). */
export async function recognizeCards(key: string, imageDataUrl: string): Promise<DetectedCard[]> {
  // До 20 карт по ~100 токенов с рамкой и языком
  const content = await askVision(
    key,
    SYSTEM_PROMPT,
    [
      { type: 'text', text: 'Read the Pokémon cards in this photo and reply with JSON.' },
      { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
    ],
    2500,
  );
  return parseRecognition(content);
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
