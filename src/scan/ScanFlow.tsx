import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { CARD_FORMS, SIMILAR_FORMS, countLabel, formatCardPrice, rarityLabel } from '@/lib/format';
import { LANGUAGE_LABELS, catalogFor, htmlLang } from '@/lib/languages';
import { candidateLimitless } from '@/lib/limitless';
import type { Candidate } from '@/lib/matching';
import { displayNames } from '@/lib/names';
import { imageFiles } from '@/lib/photo';
import { DeepseekKeyField } from '@/scan/DeepseekKeyField';
import { useScan, type Photo, type ScanItem } from '@/scan/useScan';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { CheckIcon, CloseIcon, ScanIcon } from '@/ui/Icons';
import { PopupHeader } from '@/ui/PopupHeader';
import styles from './ScanFlow.module.css';

type Props = {
  uid: string;
  owned: ReadonlyMap<string, OwnedCard>;
  /** Фото, перетащенные на главную поп-апа */
  initialFiles?: File[];
  onBack: () => void;
  onOpenAlbum: () => void;
};

/**
 * Сканер поп-апа: фото → DeepSeek → сверка с базой → выбор, если есть сомнения → альбом.
 * Во вкладке тот же сканер (`useScan`) разложен в две колонки — `ScanDesk`.
 */
export function ScanFlow({ uid, owned, initialFiles, onBack, onOpenAlbum }: Props) {
  const scan = useScan(uid, owned);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !initialFiles?.length) return;
    started.current = true;
    scan.addPhotos(initialFiles);
  }, [initialFiles, scan]);

  const total = scan.photos.length;
  const progress = total > 0 ? `${scan.finished} из ${total}` : null;
  const featured = scan.ready[scan.ready.length - 1] ?? null;
  const current = scan.pending ?? scan.missing;
  const pick = () => input.current?.click();

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    scan.addPhotos(imageFiles(event.dataTransfer.files));
  };

  let body = null;
  if (scan.key === '') {
    body = (
      <EmptyState
        title="Нужен ключ DeepSeek"
        action={<DeepseekKeyField onReady={scan.setKey} />}
      >
        Карточки распознаёт модель DeepSeek. Ключ вводится один раз и хранится только в этом браузере.
      </EmptyState>
    );
  } else if (scan.added !== null) {
    body = (
      <EmptyState
        title={`В альбом добавлено: ${countLabel(scan.added, CARD_FORMS)}`}
        action={
          <div className={styles.actions}>
            <Button className={styles.inline} start={<ScanIcon stroke={1.9} />} onClick={scan.reset}>
              Сканировать ещё
            </Button>
            <Button variant="link" onClick={onOpenAlbum}>
              Открыть альбом
            </Button>
          </div>
        }
      />
    );
  } else if (scan.key && total === 0) {
    body = (
      <div className={cx(styles.drop, dragging && styles.dropActive)}>
        <ScanIcon size={32} stroke={1.6} />
        <p className={styles.dropTitle}>Перетащи фото карточек сюда</p>
        <p className={styles.muted}>Можно несколько фото и несколько карточек на одном фото.</p>
        <Button className={styles.inline} onClick={pick}>
          Выбрать фото
        </Button>
        <p className={styles.muted}>
          Фото нужно для распознавания. Если у карточки нет скана в базе, её вырезка из фото станет обложкой и
          останется только в этом браузере.
        </p>
      </div>
    );
  } else if (scan.key) {
    body = (
      <>
        {featured && <Featured item={featured} hasPriceKey={scan.hasPriceKey} />}
        {scan.ready.length > 1 && <ReadyStrip items={scan.ready} onRemove={scan.skip} />}
        {featured && current && <div className={styles.divider} />}
        {scan.pending ? (
          <Choice
            item={scan.pending}
            afterFeatured={Boolean(featured)}
            onChoose={scan.choose}
            onAsPrinted={scan.addAsPrinted}
          />
        ) : scan.missing ? (
          <Missing item={scan.missing} onAdd={scan.addAsPrinted} onRetry={scan.retry} />
        ) : null}
        <Progress photos={scan.photos} busy={scan.busy} />
        {!scan.busy && (
          <Button variant="link" className={styles.more} onClick={pick}>
            Добавить ещё фото
          </Button>
        )}
        {scan.error && (
          <p role="alert" className={styles.error}>
            {scan.error}
          </p>
        )}
      </>
    );
  }

  return (
    <div
      className={styles.root}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <PopupHeader
        title="Сканирование"
        onBack={onBack}
        end={progress && <span className={styles.headerProgress}>{progress}</span>}
      />
      {total > 0 && (
        <div className={styles.bar} aria-hidden="true">
          <div className={styles.barFill} style={{ width: `${(scan.finished / total) * 100}%` }} />
        </div>
      )}

      <main className={styles.main}>{body}</main>

      {scan.key && scan.added === null && total > 0 && (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.skip}
            disabled={!current}
            onClick={() => current && scan.skip(current.id)}
          >
            Пропустить
          </button>
          <Button
            className={styles.add}
            disabled={scan.ready.length === 0 || scan.adding}
            onClick={() => void scan.addAll()}
          >
            {scan.adding ? 'Добавляем…' : `Добавить ${scan.ready.length} в альбом`}
          </Button>
        </footer>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          scan.addPhotos(imageFiles(event.target.files));
          event.target.value = '';
        }}
      />
    </div>
  );
}

function numberOf(localId: string, total: number | string | null): string {
  return total ? `${localId}/${total}` : localId;
}

function cardMeta(candidate: Candidate): string {
  const meta = `${candidate.setName} · ${numberOf(candidate.localId, candidate.printedTotal)}`;
  return candidate.source === 'limitless' ? `${meta} · из Limitless TCG` : meta;
}

/** Что показать о готовой карте: данные из базы или то, что напечатано, если её добавляют как есть. */
function describeItem(item: ScanItem) {
  const { detected, pick } = item;
  // Английское имя — главным, напечатанное (японское, китайское) — подписью под ним
  const { primary: name, secondary: original } = displayNames(
    pick ? pick.name : detected.name,
    pick?.englishName ?? detected.englishName,
  );
  if (pick) {
    return {
      name,
      original,
      image: pick.image,
      limitless: candidateLimitless(pick),
      number: numberOf(pick.localId, pick.printedTotal),
      meta: cardMeta(pick),
    };
  }
  const number = numberOf(detected.number, detected.total);
  return {
    name,
    original,
    image: undefined,
    limitless: null,
    number,
    meta: [detected.setCode, number].filter(Boolean).join(' · '),
  };
}

/** Почему у карты такая цена или почему её нет. */
function priceNote(item: ScanItem, hasPriceKey: boolean): string {
  if (!item.pick) return 'Цены нет: карты нет в базе';
  if (item.pick.approximate) return 'Цены нет: это похожая карта, а не твоя';
  if (!item.price || (item.price.u === null && item.price.e === null)) {
    // Доллары японских карт берутся из JustTCG по ключам клуба, их добавляет админ
    return item.pick.lang === 'ja' && !hasPriceKey ? 'Цена в долларах появится, когда админ добавит ключ JustTCG' : 'цены пока нет';
  }
  if (item.pick.lang === 'en' && item.detected.language !== 'en') return 'без грейда, цена английской';
  return 'без грейда';
}

export function Featured({ item, hasPriceKey = false }: { item: ScanItem; hasPriceKey?: boolean }) {
  const view = describeItem(item);
  const detail = item.pick ? item.details[item.pick.cardId] : undefined;
  const extra = [LANGUAGE_LABELS[item.detected.language].card, rarityLabel(detail?.rarity), item.detected.holo ? 'голо' : null]
    .filter(Boolean)
    .join(' · ');
  // Уверенность — меньшее из того, как уверена модель в прочитанном и как хорошо карта сошлась с базой
  const certainty = Math.min(item.detected.confidence, item.pick?.score ?? 1);
  const status = item.manual
    ? item.pick
      ? 'Выбрано вручную'
      : 'Добавим как есть'
    : `Распознано, ${Math.round(certainty * 100)}%`;
  const priced = item.pick !== null && !item.pick.approximate && item.price !== null;
  return (
    <section className={styles.featured}>
      <CardImage
        image={view.image}
        limitless={view.limitless}
        thumb={item.thumb}
        name={view.name}
        number={view.number}
        className={styles.featuredImage}
      />
      <div className={styles.featuredText}>
        <div className={styles.recognized}>
          <CheckIcon size={14} stroke={2.4} />
          {status}
        </div>
        <div className={styles.cardName}>{view.name}</div>
        {view.original && (
          <div className={styles.muted} lang={htmlLang(item.detected.language)}>
            {view.original}
          </div>
        )}
        <div className={styles.muted}>{view.meta}</div>
        <div className={styles.muted}>{extra}</div>
        <div className={styles.priceRow}>
          {priced && <span className={styles.price}>{formatCardPrice(item.price)}</span>}
          <span className={styles.muted}>{priceNote(item, hasPriceKey)}</span>
        </div>
      </div>
    </section>
  );
}

export function ReadyStrip({ items, onRemove }: { items: ScanItem[]; onRemove: (id: string) => void }) {
  return (
    <section className={styles.strip} aria-label="Готово к добавлению">
      <span className={styles.muted}>Готово к добавлению</span>
      <div className={styles.stripRow}>
        {items.map((item) => {
          const view = describeItem(item);
          return (
            <div key={item.id} className={styles.stripCard}>
              <CardImage image={view.image} limitless={view.limitless} thumb={item.thumb} name={view.name} />
              <button
                type="button"
                className={styles.remove}
                aria-label={`Убрать ${view.name}`}
                onClick={() => onRemove(item.id)}
              >
                <CloseIcon size={12} stroke={2.4} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function readAs(item: ScanItem): string {
  const { name, setCode, number, total } = item.detected;
  return `«${name}${setCode ? ` · ${setCode}` : ''} ${numberOf(number, total)}»`;
}

export function Choice({
  item,
  afterFeatured,
  onChoose,
  onAsPrinted,
}: {
  item: ScanItem;
  afterFeatured: boolean;
  onChoose: (itemId: string, candidate: Candidate) => void;
  onAsPrinted: (itemId: string) => void;
}) {
  const approximate = item.options.some((option) => option.approximate);
  const subtitle = approximate
    ? 'Язык карты не определён, вот похожие из английской базы'
    : item.options.length > 1
      ? `ИИ видит ${countLabel(item.options.length, SIMILAR_FORMS)}`
      : 'Проверь, та ли это карта';
  return (
    <section className={styles.choice}>
      <div>
        <div className={styles.choiceTitle}>{afterFeatured ? 'Следующая: нужна твоя помощь' : 'Нужна твоя помощь'}</div>
        <div className={styles.small}>
          {subtitle}. Прочитано {readAs(item)}
        </div>
      </div>
      <div className={styles.options}>
        {item.options.map((option) => (
          <button key={option.cardId} type="button" className={styles.option} onClick={() => onChoose(item.id, option)}>
            <CardImage
              image={option.image}
              limitless={candidateLimitless(option)}
              name={option.name}
              number={option.localId}
              className={styles.optionImage}
            />
            <span className={styles.optionText}>
              <span className={styles.optionName}>{option.name}</span>
              <span className={styles.small}>
                {[cardMeta(option), rarityLabel(item.details[option.cardId]?.rarity)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={styles.radio} aria-hidden="true" />
          </button>
        ))}
        <button type="button" className={cx(styles.option, styles.optionPlain)} onClick={() => onAsPrinted(item.id)}>
          <span className={styles.optionText}>
            <span className={styles.optionName}>Ни одна не подходит</span>
            <span className={styles.small}>Добавить как напечатана, обложкой станет фото</span>
          </span>
          <span className={styles.radio} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function Missing({
  item,
  onAdd,
  onRetry,
}: {
  item: ScanItem;
  onAdd: (itemId: string) => void;
  onRetry: (itemId: string) => void;
}) {
  const { detected } = item;
  let why = 'В базе TCGdex её не нашлось: там есть не все наборы, а новым сетам нужно время.';
  if (item.searchFailed) why = 'Проверь интернет и поищи ещё раз.';
  else if (catalogFor(detected.language).tcgdex === null) why = 'Китайских карт для КНР и корейских в базах карт нет.';
  else if (detected.language === 'ja') {
    why = detected.setCode
      ? 'Её не нашлось ни в TCGdex, ни в Limitless TCG. Проверь, что код сета и номер прочитаны верно.'
      : 'В TCGdex её не нашлось, а без кода сета её не найти в Limitless TCG.';
  }
  return (
    <section className={styles.missing}>
      <CardImage
        thumb={item.thumb}
        name={detected.name}
        number={numberOf(detected.number, detected.total)}
        className={styles.missingImage}
      />
      <div className={styles.missingText}>
        <div className={styles.choiceTitle}>{item.searchFailed ? 'База карт не ответила' : 'Этой карты нет в базе'}</div>
        <div className={styles.small}>
          Прочитано {readAs(item)}. {LANGUAGE_LABELS[detected.language].card}.
        </div>
        <div className={styles.small}>{why}</div>
        <div className={styles.small}>
          Её можно добавить как есть: обложкой станет вырезка из фото, она хранится только в этом браузере. Цены у
          такой карты не будет.
        </div>
        <div className={styles.actions}>
          <Button className={styles.inline} onClick={() => onAdd(item.id)}>
            Добавить как есть
          </Button>
          {item.searchFailed && (
            <Button variant="link" onClick={() => onRetry(item.id)}>
              Искать снова
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Progress({ photos, busy }: { photos: Photo[]; busy: boolean }) {
  const failed = photos.filter((photo) => photo.status === 'failed');
  const index = photos.findIndex((photo) => photo.status === 'reading' || photo.status === 'matching');
  return (
    <div className={styles.progress}>
      {busy && index >= 0 && (
        <p className={styles.muted}>
          {photos[index]!.status === 'reading' ? 'Читаем' : 'Ищем в базе'} фото {index + 1} из {photos.length}…
        </p>
      )}
      {failed.map((photo) => (
        <p key={photo.id} className={styles.small}>
          {photo.file.name}: {photo.message}
        </p>
      ))}
    </div>
  );
}
