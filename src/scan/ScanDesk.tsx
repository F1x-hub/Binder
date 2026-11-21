import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { CARD_FORMS, countLabel } from '@/lib/format';
import { imageFiles } from '@/lib/photo';
import { DeepseekKeyField } from '@/scan/DeepseekKeyField';
import { Choice, Featured, Missing, PhotoChoice } from '@/scan/ScanFlow';
import { useScan, type Photo, type ScanItem } from '@/scan/useScan';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { CloseIcon, PlusIcon, ScanIcon } from '@/ui/Icons';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import flow from './ScanFlow.module.css';
import styles from './ScanDesk.module.css';

type Props = {
  uid: string;
  owned: ReadonlyMap<string, OwnedCard>;
  /** Фото, брошенные на главную вкладки (src/app/scan-handoff.ts) */
  initialFiles?: File[];
  onOpenAlbum: () => void;
};

const PHOTO_FORMS: [string, string, string] = ['фото', 'фото', 'фото'];

/** Карта в списке вкладки: номер на фото и в списке один и тот же, он не меняется, если карту убрали. */
type Numbered = { item: ScanItem; n: number };

/**
 * Сканер во вкладке: та же логика, что в поп-апе (`useScan`), но в две колонки.
 * До фото — зона перетаскивания во всю ширину; после — слева фото с номерами карт поверх рамок
 * от модели, справа список всех карт с выбором вариантов, внизу липкая кнопка «Добавить N».
 * Фото можно перетащить на страницу, вставить из буфера (Ctrl+V) или выбрать файлом.
 */
export function ScanDesk({ uid, owned, initialFiles, onOpenAlbum }: Props) {
  const scan = useScan(uid, owned);
  // Фото с главной добавляются один раз, как initialFiles у ScanFlow (повторный эффект их не удвоит)
  const [start] = useState(() => ({ done: false }));
  useEffect(() => {
    if (start.done || !initialFiles?.length) return;
    start.done = true;
    scan.addPhotos(initialFiles);
  }, [initialFiles, scan, start]);
  const [dragging, setDragging] = useState(false);
  const [chosenPhoto, setChosenPhoto] = useState<string | null>(null);
  /** Карта под курсором или в фокусе: её рамка на фото выделяется */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<HTMLInputElement | null>(null);
  const pick = () => picker?.click();
  const canAdd = Boolean(scan.key);
  const { addPhotos } = scan;

  // Вставка картинки из буфера: работает на всей странице, пока есть ключ
  useEffect(() => {
    if (!canAdd) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFiles(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      addPhotos(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canAdd, addPhotos]);

  const total = scan.photos.length;
  const numbered: Numbered[] = scan.items
    .map((item, index) => ({ item, n: index + 1 }))
    .filter(({ item }) => item.status !== 'skipped');
  const processing = scan.photos.find((photo) => photo.status === 'reading' || photo.status === 'matching');
  const shown =
    scan.photos.find((photo) => photo.id === chosenPhoto) ?? processing ?? scan.photos[scan.photos.length - 1] ?? null;

  const drag = {
    onDragOver: (event: DragEvent) => {
      if (!canAdd) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!canAdd) return;
      event.preventDefault();
      setDragging(false);
      addPhotos(imageFiles(event.dataTransfer.files));
    },
  };

  /** Номер на фото ведёт к карте в списке */
  const focusItem = (id: string) => {
    const node = document.getElementById(itemDomId(id));
    if (!node) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
    setActiveId(id);
  };

  let body: ReactNode = null;
  if (scan.key === '') {
    body = (
      <EmptyState variant="page" title="Нужен ключ DeepSeek" action={<DeepseekKeyField onReady={scan.setKey} />}>
        Карточки распознаёт модель DeepSeek. Ключ вводится один раз и хранится только в этом браузере.
      </EmptyState>
    );
  } else if (scan.added !== null) {
    body = (
      <EmptyState
        variant="page"
        title={`В альбом добавлено: ${countLabel(scan.added, CARD_FORMS)}`}
        action={
          <div className={styles.doneActions}>
            <Button className={styles.inline} start={<ScanIcon stroke={1.9} />} onClick={scan.reset}>
              Сканировать ещё
            </Button>
            <Button variant="link" onClick={onOpenAlbum}>
              Открыть альбом
            </Button>
          </div>
        }
      >
        Карточки уже в альбоме. Следующие фото можно перетащить сюда или вставить из буфера.
      </EmptyState>
    );
  } else if (scan.key && total === 0) {
    body = <DropZone active={dragging} onPick={pick} />;
  } else if (scan.key) {
    body = (
      <div className={styles.desk}>
        <PhotoPanel
          photos={scan.photos}
          shown={shown}
          items={numbered}
          activeId={activeId}
          dragging={dragging}
          onShow={setChosenPhoto}
          onActive={setActiveId}
          onFocusItem={focusItem}
          onPick={pick}
        />
        <CardList
          scan={scan}
          items={numbered}
          activeId={activeId}
          onActive={setActiveId}
          onShowPhoto={setChosenPhoto}
          multiplePhotos={total > 1}
          onPick={pick}
        />
        {numbered.length > 0 && (
          <AddBar items={numbered} ready={scan.ready.length} adding={scan.adding} onAdd={() => void scan.addAll()} />
        )}
      </div>
    );
  }

  return (
    <div className={styles.root} {...drag}>
      {total > 0 && scan.added === null && (
        <p className={styles.progress} aria-live="polite">
          {scan.busy
            ? `Обработано ${scan.finished} из ${countLabel(total, PHOTO_FORMS)}`
            : [countLabel(total, PHOTO_FORMS), numbered.length > 0 && countLabel(numbered.length, CARD_FORMS)]
                .filter(Boolean)
                .join(' · ')}
        </p>
      )}
      {body}
      <input
        ref={setPicker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          addPhotos(imageFiles(event.target.files));
          event.target.value = '';
        }}
      />
    </div>
  );
}

const itemDomId = (id: string) => `scan-item-${id}`;

function DropZone({ active, onPick }: { active: boolean; onPick: () => void }) {
  return (
    <section className={styles.dropWrap} aria-label="Фото для распознавания">
      <div className={cx(styles.drop, active && styles.dropActive)}>
        <ScanIcon size={40} stroke={1.5} />
        <h2 className={styles.dropTitle}>{active ? 'Отпусти, чтобы распознать' : 'Перетащи фото карточек сюда'}</h2>
        <p className={styles.dropText}>
          Или вставь картинку из буфера: <kbd className={styles.kbd}>Ctrl</kbd> + <kbd className={styles.kbd}>V</kbd>. Можно
          несколько фото и несколько карточек на одном фото.
        </p>
        <Button className={styles.inline} start={<PlusIcon size={16} stroke={2.2} />} onClick={onPick}>
          Выбрать фото
        </Button>
      </div>
      <ul className={styles.tips}>
        <li>
          <b>Ровный свет.</b> Блик на голо мешает прочитать имя и номер.
        </li>
        <li>
          <b>Карты не внахлёст.</b> Модель обведёт каждую и пронумерует.
        </li>
        <li>
          <b>Номер и код сета в кадре.</b> По ним находится точная карта.
        </li>
      </ul>
      <p className={styles.note}>
        Фото нужно только для распознавания. Если у карточки нет скана в базе, её вырезка из фото станет обложкой и
        останется только в этом браузере.
      </p>
    </section>
  );
}

/** Адрес картинки для файла; освобождается, когда файл больше не показан. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [file]);
  return url;
}

const PHOTO_STATUS: Record<Photo['status'], string | null> = {
  waiting: 'Ждёт очереди',
  reading: 'Читаем фото…',
  matching: 'Ищем карты в базе…',
  done: null,
  failed: null,
};

function PhotoPanel({
  photos,
  shown,
  items,
  activeId,
  dragging,
  onShow,
  onActive,
  onFocusItem,
  onPick,
}: {
  photos: Photo[];
  shown: Photo | null;
  items: Numbered[];
  activeId: string | null;
  dragging: boolean;
  onShow: (id: string) => void;
  onActive: (id: string | null) => void;
  onFocusItem: (id: string) => void;
  onPick: () => void;
}) {
  const url = useObjectUrl(shown?.file ?? null);
  const onPhoto = shown ? items.filter(({ item }) => item.photoId === shown.id) : [];
  const status = shown ? PHOTO_STATUS[shown.status] : null;
  const index = shown ? photos.indexOf(shown) : -1;
  return (
    <section className={styles.photoCol} aria-labelledby="scan-photo-title">
      <div className={styles.colHead}>
        <h2 id="scan-photo-title" className={styles.colTitle}>
          {photos.length > 1 ? `Фото ${index + 1} из ${photos.length}` : 'Фото'}
        </h2>
        <Button variant="link" className={styles.morePhotos} start={<PlusIcon size={16} stroke={2.2} />} onClick={onPick}>
          Ещё фото
        </Button>
      </div>

      {photos.length > 1 && (
        <div className={styles.photoStrip}>
          {photos.map((photo, at) => (
            <PhotoThumb
              key={photo.id}
              photo={photo}
              label={`Фото ${at + 1}`}
              current={photo.id === shown?.id}
              cards={items.filter(({ item }) => item.photoId === photo.id).length}
              onShow={() => onShow(photo.id)}
            />
          ))}
        </div>
      )}

      <div className={cx(styles.photoFrame, dragging && styles.photoDragging)}>
        {url && (
          <div className={styles.photoBox}>
            <img className={styles.photo} src={url} alt={photos.length > 1 ? `Фото ${index + 1}` : 'Фото карточек'} />
            {onPhoto.map(({ item, n }) =>
              item.detected.box ? (
                <BoxMark
                  key={item.id}
                  item={item}
                  n={n}
                  active={activeId === item.id}
                  onActive={onActive}
                  onFocus={onFocusItem}
                />
              ) : null,
            )}
          </div>
        )}
        {!url && <Skeleton className={styles.photoSkeleton} />}
        {status && (
          <div className={styles.photoStatus} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            {status}
          </div>
        )}
        {shown?.status === 'failed' && (
          <div className={cx(styles.photoStatus, styles.photoFailed)}>Фото не прочиталось</div>
        )}
        {dragging && <div className={styles.dropHint}>Отпусти, чтобы добавить фото</div>}
      </div>
    </section>
  );
}

function BoxMark({
  item,
  n,
  active,
  onActive,
  onFocus,
}: {
  item: ScanItem;
  n: number;
  active: boolean;
  onActive: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const [left, top, width, height] = item.detected.box!;
  const tone = item.status === 'ready' ? styles.boxReady : styles.boxPending;
  return (
    <div
      className={cx(styles.box, tone, active && styles.boxActive)}
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
    >
      <button
        type="button"
        className={styles.boxNumber}
        aria-label={`Карта ${n}: к списку`}
        onClick={() => onFocus(item.id)}
        onMouseEnter={() => onActive(item.id)}
        onMouseLeave={() => onActive(null)}
      >
        {n}
      </button>
    </div>
  );
}

function PhotoThumb({
  photo,
  label,
  current,
  cards,
  onShow,
}: {
  photo: Photo;
  label: string;
  current: boolean;
  cards: number;
  onShow: () => void;
}) {
  const url = useObjectUrl(photo.file);
  const state =
    photo.status === 'failed'
      ? 'не прочиталось'
      : photo.status === 'done'
        ? countLabel(cards, CARD_FORMS)
        : PHOTO_STATUS[photo.status]?.replace('…', '');
  return (
    <button
      type="button"
      className={cx(styles.thumb, current && styles.thumbCurrent)}
      aria-pressed={current}
      aria-label={`${label}: ${state}`}
      title={`${label}: ${state}`}
      onClick={onShow}
    >
      {url && <img src={url} alt="" />}
      <span className={cx(styles.thumbBadge, photo.status === 'failed' && styles.thumbFailed)}>
        {photo.status === 'done' ? cards : photo.status === 'failed' ? '!' : '…'}
      </span>
    </button>
  );
}

function CardList({
  scan,
  items,
  activeId,
  onActive,
  onShowPhoto,
  multiplePhotos,
  onPick,
}: {
  scan: ReturnType<typeof useScan>;
  items: Numbered[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  onShowPhoto: (id: string) => void;
  multiplePhotos: boolean;
  onPick: () => void;
}) {
  const failed = scan.photos.filter((photo) => photo.status === 'failed');
  const waiting = items.filter(({ item }) => item.status !== 'ready').length;
  return (
    <section className={styles.listCol} aria-labelledby="scan-list-title">
      <div className={styles.colHead}>
        <h2 id="scan-list-title" className={styles.colTitle}>
          Карты на фото
        </h2>
        {items.length > 0 && (
          <span className={styles.muted}>
            {waiting > 0 ? `готово ${scan.ready.length}, ждут решения ${waiting}` : `все ${items.length} готовы`}
          </span>
        )}
      </div>

      {items.length > 0 && (
        <ol className={styles.list}>
          {items.map(({ item, n }) => (
            <li
              key={item.id}
              id={itemDomId(item.id)}
              tabIndex={-1}
              className={cx(styles.item, flow.onSurface, activeId === item.id && styles.itemActive)}
              onMouseEnter={() => {
                onActive(item.id);
                if (multiplePhotos) onShowPhoto(item.photoId);
              }}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(item.id)}
            >
              <span className={cx(styles.number, item.status !== 'ready' && styles.numberPending)} aria-hidden="true">
                {n}
              </span>
              <div className={styles.itemBody}>
                {item.status === 'ready' ? (
                  <div className={styles.readyBody}>
                    <Featured item={item} hasPriceKey={scan.hasPriceKey} />
                    <PhotoChoice item={item} onChange={scan.setKeepPhoto} />
                  </div>
                ) : item.status === 'choose' ? (
                  <Choice item={item} afterFeatured={false} onChoose={scan.choose} onAsPrinted={scan.addAsPrinted} />
                ) : (
                  <Missing item={item} onAdd={scan.addAsPrinted} onRetry={scan.retry} />
                )}
              </div>
              <button
                type="button"
                className={styles.removeItem}
                aria-label={`Убрать карту ${n}`}
                title="Не добавлять"
                onClick={() => scan.skip(item.id)}
              >
                <CloseIcon size={16} stroke={2.2} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {scan.busy && (
        <SkeletonArea label="Распознаём фото…" className={styles.listSkeleton}>
          <div className={styles.skeletonRow}>
            <Skeleton shape="card" className={styles.skeletonCard} />
            <div className={styles.skeletonText}>
              <Skeleton shape="text" width="40%" />
              <Skeleton shape="text" width="70%" />
              <Skeleton shape="text" width="55%" />
            </div>
          </div>
        </SkeletonArea>
      )}

      {!scan.busy && items.length === 0 && (
        <div className={styles.emptyList}>
          <p className={styles.emptyTitle}>
            {failed.length > 0 ? 'Карточки не распознались' : 'Все карты убраны из списка'}
          </p>
          {failed.length > 0 ? (
            <Failures photos={scan.photos} failed={failed} />
          ) : (
            <p className={styles.muted}>Добавь ещё фото или начни заново.</p>
          )}
          <div className={styles.doneActions}>
            <Button className={styles.inline} start={<PlusIcon size={16} stroke={2.2} />} onClick={onPick}>
              Другое фото
            </Button>
            <Button variant="link" onClick={scan.reset}>
              Начать заново
            </Button>
          </div>
        </div>
      )}

      {failed.length > 0 && items.length > 0 && <Failures photos={scan.photos} failed={failed} />}

      {scan.error && (
        <p role="alert" className={styles.error}>
          {scan.error}
        </p>
      )}
    </section>
  );
}

/** Почему фото не прочиталось: у одного фото — без имени файла, у нескольких — с номером. */
function Failures({ photos, failed }: { photos: Photo[]; failed: Photo[] }) {
  return (
    <ul className={styles.failures}>
      {failed.map((photo) => (
        <li key={photo.id}>
          {photos.length > 1 ? `Фото ${photos.indexOf(photo) + 1}: ` : ''}
          {photo.message}
        </li>
      ))}
    </ul>
  );
}

function AddBar({
  items,
  ready,
  adding,
  onAdd,
}: {
  items: Numbered[];
  ready: number;
  adding: boolean;
  onAdd: () => void;
}) {
  const waiting = items.length - ready;
  let summary = 'Выбери варианты в списке';
  if (ready > 0) {
    summary = waiting > 0 ? `Готово ${ready} из ${items.length}, остальные ждут решения` : `Готово ${ready} из ${items.length}`;
  }
  return (
    <div className={styles.addBar}>
      <p className={styles.addSummary}>{summary}</p>
      <Button className={styles.addButton} disabled={ready === 0 || adding} onClick={onAdd}>
        {adding ? 'Добавляем…' : `Добавить ${ready} в альбом`}
      </Button>
    </div>
  );
}
