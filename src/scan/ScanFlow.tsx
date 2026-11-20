import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { CARD_FORMS, SIMILAR_FORMS, countLabel, formatCardPrice, rarityLabel } from '@/lib/format';
import type { Candidate } from '@/lib/matching';
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
  /** Есть в поп-апе: тогда сверху шапка с кнопкой «Назад» */
  onBack?: () => void;
  onOpenAlbum: () => void;
};

/** Сканер: фото → DeepSeek → сверка с базой → выбор, если есть сомнения → альбом. */
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
        <p className={styles.muted}>Фото нужно только для распознавания и нигде не сохраняется.</p>
      </div>
    );
  } else if (scan.key) {
    body = (
      <>
        {featured && <Featured item={featured} />}
        {scan.ready.length > 1 && <ReadyStrip items={scan.ready} onRemove={scan.skip} />}
        {featured && current && <div className={styles.divider} />}
        {scan.pending ? (
          <Choice item={scan.pending} afterFeatured={Boolean(featured)} onChoose={scan.choose} />
        ) : scan.missing ? (
          <Missing item={scan.missing} />
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
      className={cx(styles.root, !onBack && styles.page)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {onBack ? (
        <PopupHeader
          title="Сканирование"
          onBack={onBack}
          end={progress && <span className={styles.headerProgress}>{progress}</span>}
        />
      ) : (
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>Сканирование</h1>
          {progress && <span className={styles.muted}>{progress}</span>}
        </div>
      )}
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

function cardMeta(candidate: Candidate): string {
  const number = candidate.printedTotal ? `${candidate.localId}/${candidate.printedTotal}` : candidate.localId;
  return `${candidate.setName} · ${number}`;
}

function Featured({ item }: { item: ScanItem }) {
  const pick = item.pick!;
  const detail = item.details[pick.cardId];
  const extra = [rarityLabel(detail?.rarity), item.detected.holo ? 'голо' : null].filter(Boolean).join(' · ');
  return (
    <section className={styles.featured}>
      <CardImage image={pick.image} name={pick.name} className={styles.featuredImage} />
      <div className={styles.featuredText}>
        <div className={styles.recognized}>
          <CheckIcon size={14} stroke={2.4} />
          {item.manual ? 'Выбрано вручную' : `Распознано, ${Math.round(item.detected.confidence * 100)}%`}
        </div>
        <div className={styles.cardName}>{pick.name}</div>
        <div className={styles.muted}>{cardMeta(pick)}</div>
        {extra && <div className={styles.muted}>{extra}</div>}
        <div className={styles.priceRow}>
          <span className={styles.price}>{formatCardPrice(item.price)}</span>
          {item.price && <span className={styles.muted}>без грейда</span>}
        </div>
      </div>
    </section>
  );
}

function ReadyStrip({ items, onRemove }: { items: ScanItem[]; onRemove: (id: string) => void }) {
  return (
    <section className={styles.strip} aria-label="Готово к добавлению">
      <span className={styles.muted}>Готово к добавлению</span>
      <div className={styles.stripRow}>
        {items.map((item) => (
          <div key={item.id} className={styles.stripCard}>
            <CardImage image={item.pick!.image} name={item.pick!.name} />
            <button
              type="button"
              className={styles.remove}
              aria-label={`Убрать ${item.pick!.name}`}
              onClick={() => onRemove(item.id)}
            >
              <CloseIcon size={12} stroke={2.4} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function readAs(item: ScanItem): string {
  const { name, number, total } = item.detected;
  return `«${name} ${number}${total ? `/${total}` : ''}»`;
}

function Choice({
  item,
  afterFeatured,
  onChoose,
}: {
  item: ScanItem;
  afterFeatured: boolean;
  onChoose: (itemId: string, candidate: Candidate) => void;
}) {
  const subtitle =
    item.options.length > 1
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
            <CardImage image={option.image} name={option.name} className={styles.optionImage} />
            <span className={styles.optionText}>
              <span className={styles.optionName}>{option.name}</span>
              <span className={styles.small}>
                {[cardMeta(option), rarityLabel(item.details[option.cardId]?.rarity)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={styles.radio} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function Missing({ item }: { item: ScanItem }) {
  return (
    <section className={styles.choice}>
      <div className={styles.choiceTitle}>Не нашли в базе</div>
      <div className={styles.small}>
        Прочитано {readAs(item)}. Если сет совсем новый, базе нужно время. Пропусти карту или сфотографируй её ещё раз
        крупнее.
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
