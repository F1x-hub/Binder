import { useCallback, useEffect, useRef, useState } from 'react';
import { catalog, findCandidates } from '@/lib/catalog';
import { addToCollection, type NewCard, type OwnedCard, type Variant } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { loadDeepseekKey, recognizeCards, recognizeErrorMessage } from '@/lib/deepseek';
import { decide, type Candidate, type DetectedCard } from '@/lib/matching';
import { PhotoError, preparePhoto } from '@/lib/photo';
import { loadPrices, type CardPrice } from '@/lib/prices';
import type { CardDetail } from '@/lib/tcgdex';

export type Photo = {
  id: string;
  file: File;
  status: 'waiting' | 'reading' | 'matching' | 'done' | 'failed';
  message?: string;
};

/** Одна карта с фото: узнана, ждёт выбора, не найдена или пропущена. */
export type ScanItem = {
  id: string;
  detected: DetectedCard;
  status: 'ready' | 'choose' | 'not-found' | 'skipped';
  options: Candidate[];
  pick: Candidate | null;
  /** Выбрана человеком из вариантов, а не узнана сама */
  manual: boolean;
  /** Подробности из справочника по ID карты: редкость и варианты печати */
  details: Record<string, CardDetail>;
  price: CardPrice | null;
};

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Вариант печати для альбома: модель отличает голо от обычной, справочник знает, что бывает у карты. */
export function variantFor(detected: Pick<DetectedCard, 'holo'>, detail: Pick<CardDetail, 'variants'> | undefined): Variant {
  const variants = detail?.variants;
  if (detected.holo === true) return variants?.holo || !variants?.reverse ? 'holo' : 'reverse';
  if (variants && variants.normal === false && variants.holo) return 'holo';
  return 'normal';
}

export function useScan(uid: string, owned: ReadonlyMap<string, OwnedCard>) {
  /** null — ещё не прочитан из хранилища, пустая строка — ключа нет */
  const [key, setKey] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  useEffect(() => {
    void loadDeepseekKey().then(setKey);
  }, []);

  const updateItem = useCallback((id: string, patch: (item: ScanItem) => Partial<ScanItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch(item) } : item)));
  }, []);

  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setPhotos((list) => list.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)));
  }, []);

  /** Редкость, вариант печати и цена выбранной карты. */
  const enrich = useCallback(
    async (itemId: string, candidate: Candidate) => {
      const [detail, prices] = await Promise.all([
        catalog.card(candidate.cardId).catch(() => null),
        loadPrices(binderDb(), [{ cardId: candidate.cardId, setId: candidate.setId }]).catch(
          () => new Map<string, CardPrice>(),
        ),
      ]);
      updateItem(itemId, (item) => ({
        details: detail ? { ...item.details, [candidate.cardId]: detail } : item.details,
        price: prices.get(candidate.cardId) ?? null,
      }));
    },
    [updateItem],
  );

  /** Редкость вариантов на выбор, чтобы их было проще различить. */
  const describeOptions = useCallback(
    async (itemId: string, options: Candidate[]) => {
      const details = await Promise.all(options.map((option) => catalog.card(option.cardId).catch(() => null)));
      const known = Object.fromEntries(details.filter((detail) => detail !== null).map((detail) => [detail.id, detail]));
      updateItem(itemId, (item) => ({ details: { ...item.details, ...known } }));
    },
    [updateItem],
  );

  // Очередь фото обрабатывается по одному: так видно прогресс и не уходит лишних запросов
  useEffect(() => {
    if (working.current || !key) return;
    const photo = photos.find((item) => item.status === 'waiting');
    if (!photo) return;
    working.current = true;
    void (async () => {
      try {
        updatePhoto(photo.id, { status: 'reading' });
        const detected = await recognizeCards(key, await preparePhoto(photo.file));
        if (detected.length === 0) {
          updatePhoto(photo.id, { status: 'failed', message: 'На фото не нашлось карточек' });
          return;
        }
        updatePhoto(photo.id, { status: 'matching' });
        for (const card of detected) {
          const decision = decide(await findCandidates(card).catch(() => []));
          const item: ScanItem = {
            id: nextId(),
            detected: card,
            status: decision.status,
            options: decision.status === 'choose' ? decision.options : [],
            pick: decision.status === 'ready' ? decision.pick : null,
            manual: false,
            details: {},
            price: null,
          };
          setItems((list) => [...list, item]);
          if (item.pick) void enrich(item.id, item.pick);
          if (item.options.length > 0) void describeOptions(item.id, item.options);
        }
        updatePhoto(photo.id, { status: 'done' });
      } catch (failure) {
        const message = failure instanceof PhotoError ? failure.message : recognizeErrorMessage(failure);
        updatePhoto(photo.id, { status: 'failed', message });
      } finally {
        working.current = false;
        setPhotos((list) => [...list]); // разбудить эффект ради следующего фото
      }
    })();
  }, [photos, key, enrich, describeOptions, updatePhoto]);

  const addPhotos = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setAdded(null);
    setError(null);
    setPhotos((list) => [...list, ...files.map((file) => ({ id: nextId(), file, status: 'waiting' as const }))]);
  }, []);

  const choose = (itemId: string, candidate: Candidate) => {
    updateItem(itemId, () => ({ status: 'ready', pick: candidate, manual: true }));
    void enrich(itemId, candidate);
  };

  const skip = (itemId: string) => updateItem(itemId, () => ({ status: 'skipped' }));

  const ready = items.filter((item) => item.status === 'ready' && item.pick !== null);
  const pending = items.find((item) => item.status === 'choose') ?? null;
  const missing = items.find((item) => item.status === 'not-found') ?? null;
  const finished = photos.filter((photo) => photo.status === 'done' || photo.status === 'failed').length;
  const busy = photos.some((photo) => ['waiting', 'reading', 'matching'].includes(photo.status));

  const addAll = async () => {
    setAdding(true);
    setError(null);
    try {
      const cards: NewCard[] = ready.map((item) => {
        const pick = item.pick!;
        return { cardId: pick.cardId, setId: pick.setId, variant: variantFor(item.detected, item.details[pick.cardId]) };
      });
      await addToCollection(binderDb(), uid, cards, owned);
      setAdded(cards.length);
      setItems([]);
      setPhotos([]);
    } catch {
      setError('Не получилось добавить карточки. Проверь интернет и попробуй ещё раз.');
    } finally {
      setAdding(false);
    }
  };

  const reset = () => {
    setItems([]);
    setPhotos([]);
    setAdded(null);
    setError(null);
  };

  return {
    key,
    setKey,
    photos,
    ready,
    pending,
    missing,
    finished,
    busy,
    adding,
    added,
    error,
    addPhotos,
    choose,
    skip,
    addAll,
    reset,
  };
}
