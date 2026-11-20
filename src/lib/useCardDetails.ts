import { useEffect, useMemo, useState } from 'react';
import { cardDetails, detailRequest, type CardDetail, type DetailRequest } from '@/lib/card-details';
import type { CardView } from '@/lib/useCardViews';

/** Сколько ответивших карт копится до перерисовки: сведения приходят частями, без сотен перерисовок. */
const PUBLISH_EVERY = 12;

/**
 * Полные карточки карт альбома (src/lib/card-details.ts), по ID документа альбома.
 * include отбирает карты, которые нужны месту: фильтрам альбома не нужны похожие карты.
 * loading — пока ответили не все карты; неудачная карта считается ответившей, у неё сведений нет.
 */
export function useCardDetails(
  views: readonly CardView[] | null,
  include: (view: CardView) => boolean = () => true,
): { details: ReadonlyMap<string, CardDetail>; loading: boolean } {
  const requests = useMemo(
    () =>
      (views ?? []).flatMap((view) => {
        const request = include(view) ? detailRequest(view) : null;
        return request ? [{ docId: view.docId, request }] : [];
      }),
    // include — постоянная функция места, не зависимость
    [views],
  );
  const key = requests
    .map(({ docId, request }) => `${docId}=${request.key}`)
    .sort()
    .join('|');
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const missing: DetailRequest[] = requests.map(({ request }) => request).filter((request) => !cardDetails.has(request.key));
    if (missing.length === 0) {
      setSettled(key);
      return;
    }
    let count = 0;
    void cardDetails
      .load(missing, {
        onSettled: () => {
          count += 1;
          if (active && count % PUBLISH_EVERY === 0) setVersion((value) => value + 1);
        },
      })
      .then(() => {
        if (!active) return;
        setVersion((value) => value + 1);
        setSettled(key);
      });
    return () => {
      active = false;
    };
    // requests меняются вместе с key: запрашиваем только новые карты
  }, [key]);

  const details = useMemo(() => {
    const map = new Map<string, CardDetail>();
    for (const { docId, request } of requests) {
      const detail = cardDetails.get(request.key);
      if (detail) map.set(docId, detail);
    }
    return map;
    // version — сигнал, что в кэш пришли новые карточки
  }, [requests, version]);

  // Всё уже в кэше — не загрузка, даже до того, как эффект отметил состав
  const loading =
    views === null || (settled !== key && requests.some(({ request }) => !cardDetails.has(request.key)));
  return { details, loading };
}
