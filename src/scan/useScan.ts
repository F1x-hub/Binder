import { useCallback, useEffect, useRef, useState } from 'react';
import { catalog, findCandidates } from '@/lib/catalog';
import {
  PRINTED_LIMITS,
  addToCollection,
  customCard,
  type NewCard,
  type OwnedCard,
  type PrintedCard,
  type Variant,
} from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { loadDeepseekKey, recognizeCards, recognizeErrorMessage } from '@/lib/deepseek';
import { albumDocId } from '@/lib/languages';
import { decide, type Candidate, type Decision, type DetectedCard } from '@/lib/matching';
import { PhotoError, cropCard, preparePhoto } from '@/lib/photo';
import { loadJapanesePrices, type JapaneseRef } from '@/lib/jp-prices';
import { activeClubKeys } from '@/lib/club-keys';
import { loadPrices, priceKey, type CardPrice } from '@/lib/prices';
import type { CardDetail } from '@/lib/tcgdex';
import { cropPhoto, queuePhotos } from '@/lib/my-photos';
import { saveThumb } from '@/lib/thumbnails';
import { mergePrice } from '@/lib/useCardViews';

export type Photo = {
  id: string;
  file: File;
  status: 'waiting' | 'reading' | 'matching' | 'done' | 'failed';
  message?: string;
};

/** Одна карта с фото: узнана, ждёт выбора, не найдена или пропущена. */
export type ScanItem = {
  id: string;
  /** С какого фото карта: во вкладке её номер рисуется поверх этого фото */
  photoId: string;
  detected: DetectedCard;
  status: 'ready' | 'choose' | 'not-found' | 'skipped';
  options: Candidate[];
  /** Карта из базы; у готовой карты null — она добавится как напечатана, без базы */
  pick: Candidate | null;
  /** Выбрана или добавлена человеком, а не узнана сама */
  manual: boolean;
  /** Подробности из справочника по ID карты: редкость и варианты печати */
  details: Record<string, CardDetail>;
  price: CardPrice | null;
  /** Вырезка карты из фото (WebP): обложка, если у карты нет скана в базе */
  thumb: string | null;
  /** Своё фото карты 720 px: уходит в Google Drive участника, если он хранит фото там */
  photo: string | null;
  /** «Моё фото»: сохранить фото в Drive и показывать его в альбоме вместо официального скана */
  keepPhoto: boolean;
  /** База карт не ответила: искать можно ещё раз */
  searchFailed: boolean;
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

const clip = (value: string | null, max: number) => (value ? value.slice(0, max) : null);

/** Что напечатано на карте, в пределах длины из правил Firestore. */
export function printedOf(detected: DetectedCard): PrintedCard {
  return {
    name: detected.name.slice(0, PRINTED_LIMITS.name),
    englishName: clip(detected.englishName, PRINTED_LIMITS.englishName),
    number: detected.number.slice(0, PRINTED_LIMITS.number),
    total: clip(detected.total, PRINTED_LIMITS.total),
    setCode: clip(detected.setCode, PRINTED_LIMITS.setCode),
  };
}

/**
 * Запись в альбом для готовой карты и обложка, которую надо сохранить в этом браузере:
 * только если у карты нет скана в базе.
 */
export function toNewCard(item: Pick<ScanItem, 'detected' | 'pick' | 'details' | 'thumb'>): { card: NewCard; thumb: string | null } {
  const lang = item.detected.language;
  const { pick } = item;
  if (pick?.source === 'limitless' || pick?.source === 'asia') {
    // Карты нет в TCGdex: в альбом идёт напечатанное, но имя и код сета — сверенные с Limitless
    // (японские) или с официальным сайтом Pokémon Asia (тайваньские)
    const printed: PrintedCard = {
      ...printedOf(item.detected),
      name: pick.name.slice(0, PRINTED_LIMITS.name),
      englishName: clip(pick.englishName ?? item.detected.englishName, PRINTED_LIMITS.englishName),
      setCode: pick.setId.slice(0, PRINTED_LIMITS.setCode),
    };
    const { docId, setId } = customCard(lang, printed);
    return { card: { docId, setId, lang, variant: variantFor(item.detected, undefined), printed }, thumb: item.thumb };
  }
  if (pick) {
    return {
      card: {
        docId: albumDocId(pick.cardId, lang),
        setId: pick.setId,
        lang,
        variant: variantFor(item.detected, item.details[pick.cardId]),
      },
      thumb: pick.image ? null : item.thumb,
    };
  }
  const printed = printedOf(item.detected);
  const { docId, setId } = customCard(lang, printed);
  return { card: { docId, setId, lang, variant: variantFor(item.detected, undefined), printed }, thumb: item.thumb };
}

/** У карты нет официального скана ни в TCGdex, ни в Limitless: своё фото — единственная картинка. */
export function photoOnly(item: Pick<ScanItem, 'pick'>): boolean {
  return !item.pick || (!item.pick.image && item.pick.source !== 'limitless');
}

/** Поиск в базе; если база не ответила, карта не найдена, но искать можно снова. */
async function search(card: DetectedCard): Promise<{ decision: Decision; failed: boolean }> {
  try {
    return { decision: decide(await findCandidates(card)), failed: false };
  } catch {
    return { decision: { status: 'not-found' }, failed: true };
  }
}

function fromDecision(decision: Decision): Pick<ScanItem, 'status' | 'options' | 'pick'> {
  return {
    status: decision.status,
    options: decision.status === 'choose' ? decision.options : [],
    pick: decision.status === 'ready' ? decision.pick : null,
  };
}

export function useScan(uid: string, owned: ReadonlyMap<string, OwnedCard>) {
  /** null — ещё не прочитан из хранилища, пустая строка — ключа нет */
  const [key, setKey] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Есть ли в клубе ключи JustTCG: без них у японских карт нет цены в долларах, и сканер об этом скажет */
  const [hasPriceKey, setHasPriceKey] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    void loadDeepseekKey().then(setKey);
    void activeClubKeys(binderDb())
      .then((keys) => setHasPriceKey(keys.length > 0))
      .catch(() => undefined);
  }, []);

  const updateItem = useCallback((id: string, patch: (item: ScanItem) => Partial<ScanItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch(item) } : item)));
  }, []);

  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setPhotos((list) => list.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)));
  }, []);

  /**
   * Редкость, вариант печати и цена выбранной карты. Из TCGdex — редкость и цена, у японских
   * карт (из TCGdex и из Limitless) — ещё доллары JustTCG. У похожей карты цены нет:
   * она была бы чужой.
   */
  const enrich = useCallback(
    async (itemId: string, candidate: Candidate, detected: DetectedCard) => {
      const fromTcgdex = candidate.source === 'tcgdex';
      const japanese: JapaneseRef = {
        key: 'pick',
        setCode: candidate.setId,
        number: candidate.localId,
        total: candidate.printedTotal ? String(candidate.printedTotal) : detected.total,
        englishName: candidate.englishName ?? detected.englishName,
        printing: detected.holo ? 'holo' : 'normal',
        verifyName: false,
      };
      const [detail, prices, dollars] = await Promise.all([
        fromTcgdex ? catalog.card(candidate.cardId, candidate.lang).catch(() => null) : null,
        fromTcgdex && !candidate.approximate
          ? loadPrices(binderDb(), [{ cardId: candidate.cardId, setId: candidate.setId, lang: candidate.lang }]).catch(
              () => new Map<string, CardPrice>(),
            )
          : new Map<string, CardPrice>(),
        candidate.lang === 'ja' && !candidate.approximate
          ? loadJapanesePrices(binderDb(), [japanese]).catch(() => new Map<string, number>())
          : new Map<string, number>(),
      ]);
      updateItem(itemId, (item) => ({
        details: detail ? { ...item.details, [candidate.cardId]: detail } : item.details,
        price: mergePrice(prices.get(priceKey(candidate.lang, candidate.cardId)) ?? null, dollars.get('pick') ?? null),
      }));
    },
    [updateItem],
  );

  /** Редкость вариантов на выбор, чтобы их было проще различить. */
  const describeOptions = useCallback(
    async (itemId: string, options: Candidate[]) => {
      const details = await Promise.all(
        options.map((option) =>
          option.source === 'tcgdex' ? catalog.card(option.cardId, option.lang).catch(() => null) : null,
        ),
      );
      const known = Object.fromEntries(details.filter((detail) => detail !== null).map((detail) => [detail.id, detail]));
      updateItem(itemId, (item) => ({ details: { ...item.details, ...known } }));
    },
    [updateItem],
  );

  const settle = useCallback(
    (itemId: string, detected: DetectedCard, decision: Decision, failed: boolean) => {
      const next = fromDecision(decision);
      updateItem(itemId, () => ({ ...next, searchFailed: failed }));
      if (next.pick) void enrich(itemId, next.pick, detected);
      if (next.options.length > 0) void describeOptions(itemId, next.options);
    },
    [updateItem, enrich, describeOptions],
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
        const prepared = await preparePhoto(photo.file);
        const detected = await recognizeCards(key, prepared.dataUrl);
        if (detected.length === 0) {
          updatePhoto(photo.id, { status: 'failed', message: 'На фото не нашлось карточек' });
          return;
        }
        updatePhoto(photo.id, { status: 'matching' });
        for (const card of detected) {
          const { decision, failed } = await search(card);
          const item: ScanItem = {
            id: nextId(),
            photoId: photo.id,
            detected: card,
            ...fromDecision(decision),
            manual: false,
            details: {},
            price: null,
            thumb: cropCard(prepared.canvas, card.box, detected.length === 1),
            photo: cropPhoto(prepared.canvas, card.box, detected.length === 1),
            keepPhoto: false,
            searchFailed: failed,
          };
          setItems((list) => [...list, item]);
          if (item.pick) void enrich(item.id, item.pick, card);
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
    const item = items.find((entry) => entry.id === itemId);
    updateItem(itemId, () => ({ status: 'ready', pick: candidate, manual: true, price: null }));
    if (item) void enrich(itemId, candidate, item.detected);
  };

  /** Добавить карту как напечатана: в базе её нет или ни один вариант не подошёл. */
  const addAsPrinted = (itemId: string) =>
    updateItem(itemId, () => ({ status: 'ready', pick: null, manual: true, price: null }));

  const retry = (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    updateItem(itemId, () => ({ searchFailed: false }));
    void search(item.detected).then(({ decision, failed }) => settle(itemId, item.detected, decision, failed));
  };

  const skip = (itemId: string) => updateItem(itemId, () => ({ status: 'skipped' }));

  /** «Официальный скан» или «Моё фото» для этой карты (с Google Drive в настройках). */
  const setKeepPhoto = (itemId: string, keep: boolean) => updateItem(itemId, () => ({ keepPhoto: keep }));

  const ready = items.filter((item) => item.status === 'ready');
  const pending = items.find((item) => item.status === 'choose') ?? null;
  const missing = items.find((item) => item.status === 'not-found') ?? null;
  const finished = photos.filter((photo) => photo.status === 'done' || photo.status === 'failed').length;
  const busy = photos.some((photo) => ['waiting', 'reading', 'matching'].includes(photo.status));

  const addAll = async () => {
    setAdding(true);
    setError(null);
    try {
      const entries = ready.map(toNewCard);
      await addToCollection(
        binderDb(),
        uid,
        entries.map((entry) => entry.card),
        owned,
      );
      // Обложки нужны только в этом браузере: если не сохранились, альбом покажет заглушку
      await Promise.all(
        entries.map((entry) => (entry.thumb ? saveThumb(entry.card.docId, entry.thumb).catch(() => undefined) : undefined)),
      );
      // Свои фото — в Google Drive, если он выбран в настройках: с «Моё фото» и у карт без скана
      await queuePhotos(
        ready.flatMap((item, index) =>
          item.photo && (item.keepPhoto || photoOnly(item))
            ? [{ docId: entries[index]!.card.docId, dataUrl: item.photo, show: 'mine' as const }]
            : [],
        ),
      ).catch(() => undefined);
      setAdded(entries.length);
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
    hasPriceKey,
    photos,
    /** Все карты по порядку распознавания, с пропущенными: вкладка показывает их списком */
    items,
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
    addAsPrinted,
    retry,
    skip,
    setKeepPhoto,
    addAll,
    reset,
  };
}
