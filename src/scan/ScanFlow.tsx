import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { CARD_FORMS, SIMILAR_FORMS, countLabel, formatCardPrice, rarityLabel } from '@/lib/format';
import { searchCatalog } from '@/lib/catalog';
import { LANGUAGE_LABELS, catalogFor, htmlLang, type CardLanguage } from '@/lib/languages';
import { candidateLimitless } from '@/lib/limitless';
import { usePhotoStore } from '@/lib/my-photos';
import { MODEL_TRUST, type Candidate } from '@/lib/matching';
import { displayNames } from '@/lib/names';
import { imageFiles } from '@/lib/photo';
import { DeepseekKeyField } from '@/scan/DeepseekKeyField';
import { photoOnly, useScan, type Photo, type ScanItem } from '@/scan/useScan';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { CheckIcon, CloseIcon, ScanIcon, SearchIcon } from '@/ui/Icons';
import { PopupHeader } from '@/ui/PopupHeader';
import { Zoom } from '@/scan/Zoom';
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
        {featured && <Featured item={featured} hasPriceKey={scan.hasPriceKey} onReopen={scan.reopen} />}
        {featured && <PhotoChoice item={featured} onChange={scan.setKeepPhoto} />}
        {scan.ready.length > 1 && <ReadyStrip items={scan.ready} onRemove={scan.skip} />}
        {featured && current && <div className={styles.divider} />}
        {scan.pending ? (
          <Choice
            key={scan.pending.id}
            item={scan.pending}
            afterFeatured={Boolean(featured)}
            onChoose={scan.choose}
            onAsPrinted={scan.addAsPrinted}
          />
        ) : scan.missing ? (
          <Missing
            key={scan.missing.id}
            item={scan.missing}
            onAdd={scan.addAsPrinted}
            onRetry={scan.retry}
            onChoose={scan.choose}
          />
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
  if (candidate.source === 'limitless') return `${meta} · из Limitless TCG`;
  if (candidate.source === 'asia') return `${meta} · с сайта Pokémon Asia`;
  return meta;
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

export function Featured({
  item,
  hasPriceKey = false,
  onReopen,
}: {
  item: ScanItem;
  hasPriceKey?: boolean;
  /** «Другая печать»: у карты, выбранной по фото или вручную из вариантов */
  onReopen?: (itemId: string) => void;
}) {
  const view = describeItem(item);
  const detail = item.pick ? item.details[item.pick.cardId] : undefined;
  const extra = [LANGUAGE_LABELS[item.detected.language].card, rarityLabel(detail?.rarity), item.detected.holo ? 'голо' : null]
    .filter(Boolean)
    .join(' · ');
  // Уверенность — меньшее из того, как уверена модель в прочитанном и как хорошо карта сошлась с базой
  const certainty = Math.min(item.detected.confidence, item.pick?.score ?? 1);
  const look = item.pick ? item.likeness[item.pick.cardId] : undefined;
  const status = item.manual
    ? item.pick
      ? 'Выбрано вручную'
      : 'Добавим как есть'
    : item.byLook && look !== undefined
      ? `Похоже на фото, ${Math.round(look * 100)}%`
      : `Распознано, ${Math.round(certainty * 100)}%`;
  const canReopen = Boolean(onReopen) && item.options.length > 1;
  const priced = item.pick !== null && !item.pick.approximate && item.price !== null;
  // С «Моё фото» видно, что ляжет в альбом: своё фото вместо скана
  const mine = item.keepPhoto && Boolean(item.photo);
  return (
    <section className={styles.featured}>
      <CardImage
        image={mine ? undefined : view.image}
        limitless={mine ? null : view.limitless}
        thumb={mine ? item.photo : item.thumb}
        name={view.name}
        number={view.number}
        className={styles.featuredImage}
      />
      <div className={styles.featuredText}>
        <div className={styles.recognized}>
          <CheckIcon size={14} stroke={2.4} />
          {status}
        </div>
        {item.byLook && (
          <div className={styles.small}>ИИ не уверен в номере, а картинка совпала с этой печатью лучше остальных.</div>
        )}
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
        {canReopen && (
          <Button variant="link" className={styles.reopen} onClick={() => onReopen?.(item.id)}>
            Другая печать
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * «Официальный скан / Моё фото» у готовой карты, по макету PopupScan: своё фото сохранится
 * в Google Drive участника и будет в альбоме вместо скана. Только если в настройках выбран Drive.
 * У карты без скана выбирать нечего: её фото сохраняется в Drive само.
 */
export function PhotoChoice({ item, onChange }: { item: ScanItem; onChange: (itemId: string, keep: boolean) => void }) {
  const store = usePhotoStore();
  if (store !== 'drive' || !item.photo || item.status !== 'ready') return null;
  if (photoOnly(item)) {
    return <p className={styles.small}>Скана этой карты нет в базе: в альбоме будет твоё фото, оно сохранится в твой Google Drive.</p>;
  }
  return (
    <div className={styles.photoChoice}>
      <span className={styles.small}>Какое фото показывать в альбоме</span>
      <div role="group" aria-label="Фото в альбоме" className={styles.segmented}>
        <button type="button" aria-pressed={!item.keepPhoto} onClick={() => onChange(item.id, false)}>
          Официальный скан
        </button>
        <button type="button" aria-pressed={item.keepPhoto} onClick={() => onChange(item.id, true)}>
          Моё фото
        </button>
      </div>
      {item.keepPhoto && <span className={styles.small}>Фото сохранится в твой Google Drive. Друзья увидят официальный скан.</span>}
    </div>
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

/** Сколько вариантов видно сразу: остальные — по «Показать ещё». */
const VISIBLE_OPTIONS = 4;
/** Если самый похожий на фото вариант найден, сразу видно на один меньше. */
const VISIBLE_WITH_BEST = 3;

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
  const [expanded, setExpanded] = useState(false);
  const [searching, setSearching] = useState(false);
  const approximate = item.options.some((option) => option.approximate);
  const why = approximate
    ? 'Язык карты не определён, вот похожие из английской базы'
    : item.detected.confidence < MODEL_TRUST
      ? 'ИИ не уверен в прочитанном, вот печати этой карты'
      : item.options.some((option) => option.weak)
        ? 'Номер не подтвердился, вот печати этой карты'
        : item.options.length > 1
          ? `ИИ видит ${countLabel(item.options.length, SIMILAR_FORMS)}`
          : 'Проверь, та ли это карта';
  const order = item.bestLook
    ? 'Первой — печать, больше всего похожая на фото.'
    : item.looking
      ? 'Сравниваем печати с фото…'
      : Object.keys(item.likeness).length > 1
        ? 'Похожие на фото — выше.'
        : null;
  const limit = item.bestLook ? VISIBLE_WITH_BEST : VISIBLE_OPTIONS;
  const shown = expanded ? item.options : item.options.slice(0, limit);
  const hidden = item.options.length - shown.length;
  return (
    <section className={styles.choice}>
      <div className={styles.choiceHead}>
        <PhotoCrop item={item} />
        <div>
          <div className={styles.choiceTitle}>{afterFeatured ? 'Следующая: нужна твоя помощь' : 'Нужна твоя помощь'}</div>
          <div className={styles.small}>
            {why}. Прочитано {readAs(item)}.{order && ` ${order}`}
          </div>
        </div>
      </div>
      <div className={styles.options}>
        {shown.map((option) => (
          <OptionRow
            key={option.cardId}
            option={option}
            rarity={rarityLabel(item.details[option.cardId]?.rarity)}
            best={option.cardId === item.bestLook}
            onChoose={() => onChoose(item.id, option)}
          />
        ))}
        {hidden > 0 && (
          <button type="button" className={styles.moreOptions} onClick={() => setExpanded(true)}>
            Показать ещё {hidden}
          </button>
        )}
        {searching ? (
          <CardSearch item={item} onChoose={onChoose} onAsPrinted={onAsPrinted} onClose={() => setSearching(false)} />
        ) : (
          <button type="button" className={cx(styles.option, styles.optionPlain)} onClick={() => setSearching(true)}>
            <SearchIcon size={18} stroke={2} />
            <span className={styles.optionText}>
              <span className={styles.optionName}>Ни одна не подходит</span>
              <span className={styles.small}>Найти карту в базе по имени, номеру или сету</span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

function optionLabel(option: Candidate): string {
  return `${displayNames(option.name, option.englishName).primary}, ${cardMeta(option)}`;
}

/** Обложка варианта крупно: скан высокого качества. */
function bigCover(option: Candidate) {
  return () => (
    <CardImage
      image={option.image}
      limitless={candidateLimitless(option)}
      name={displayNames(option.name, option.englishName).primary}
      number={option.localId}
      quality="high"
    />
  );
}

/**
 * Вариант на выбор: обложка (наведение, фокус на строке с клавиатуры или касание обложки
 * показывают её крупно) и строка — кнопка выбора. Щелчок мышью по обложке тоже выбирает.
 */
function OptionRow({
  option,
  rarity,
  best = false,
  onChoose,
}: {
  option: Candidate;
  rarity?: string | null;
  best?: boolean;
  onChoose: () => void;
}) {
  const [keyboard, setKeyboard] = useState(false);
  const { primary, secondary } = displayNames(option.name, option.englishName);
  return (
    <div className={cx(styles.option, styles.optionRow, best && styles.optionBest)}>
      <Zoom
        label={optionLabel(option)}
        big={bigCover(option)}
        active={keyboard}
        focusable={false}
        onMouseClick={onChoose}
        className={styles.optionCover}
      >
        <CardImage
          image={option.image}
          limitless={candidateLimitless(option)}
          name={primary}
          number={option.localId}
          className={styles.optionImage}
        />
      </Zoom>
      <button
        type="button"
        className={styles.optionPick}
        onClick={onChoose}
        onFocus={(event) => setKeyboard(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeyboard(false)}
      >
        <span className={styles.optionText}>
          {best && <span className={styles.bestTag}>Похоже больше всего</span>}
          <span className={styles.optionName}>{primary}</span>
          {secondary && (
            <span className={styles.small} lang={htmlLang(option.lang)}>
              {secondary}
            </span>
          )}
          <span className={styles.small}>{[cardMeta(option), rarity].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={styles.radio} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Карта, как она на фото: вырезка по рамке модели, её тоже можно рассмотреть крупно. */
function PhotoCrop({ item }: { item: ScanItem }) {
  const src = item.photo ?? item.thumb;
  if (!src) return null;
  return (
    <Zoom label="твоя карта на фото" big={() => <img src={src} alt="Твоя карта на фото" />} className={styles.crop}>
      <img src={item.thumb ?? src} alt="" />
      <span className={styles.cropLabel}>Фото</span>
    </Zoom>
  );
}

/** Задержка перед поиском: пока печатают, запросов нет. */
const SEARCH_DELAY = 350;
/** Сколько найденных карт видно сразу. */
const VISIBLE_FOUND = 6;

/** Подсказка, что можно искать: у корейских карт — только код сета и номер. */
function searchHint(language: CardLanguage): string {
  if (language === 'ko') return 'Код сета и номер: SV2a 94';
  if (language === 'zh-cn') return 'Имя и номер или сет: 皮卡丘 25, CSV1C 161';
  if (language === 'ja') return 'Имя, номер или сет: メガゲンガー 3, SV2a 94, MBG 3';
  return 'Имя, номер или сет: Pikachu ex 149, 30th 150';
}

/**
 * Свой поиск по базе языка карты (searchCatalog): имя, номер, сет. Ищется через 350 мс после
 * последней буквы, ответы хранятся до конца жизни вкладки. Последний пункт — добавить карту
 * как напечатана, если в базе её нет.
 */
export function CardSearch({
  item,
  onChoose,
  onAsPrinted,
  onClose,
}: {
  item: ScanItem;
  onChoose: (itemId: string, candidate: Candidate) => void;
  onAsPrinted: (itemId: string) => void;
  onClose?: () => void;
}) {
  const language = item.detected.language;
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{
    query: string;
    found: Candidate[];
    failed: boolean;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  useEffect(() => field.current?.focus(), []);

  useEffect(() => {
    if (trimmed.length < 2) return;
    let stale = false;
    const timer = setTimeout(() => {
      searchCatalog(trimmed, language).then(
        (found) => !stale && setResult({ query: trimmed, found, failed: false }),
        () => !stale && setResult({ query: trimmed, found: [], failed: true }),
      );
    }, SEARCH_DELAY);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed, language]);

  const current = result && result.query === trimmed && trimmed.length >= 2 ? result : null;
  const found = current?.found ?? [];
  const shown = expanded ? found : found.slice(0, VISIBLE_FOUND);
  let status = 'Напиши хотя бы два знака';
  if (trimmed.length >= 2 && !current) status = 'Ищем…';
  else if (current?.failed) status = 'База не ответила. Проверь интернет и попробуй ещё раз.';
  else if (current && found.length === 0) status = 'Ничего не нашлось. Попробуй другое имя, номер или сет.';
  else if (current) status = `Нашлось: ${countLabel(found.length, CARD_FORMS)}`;
  const fieldId = `scan-search-${item.id}`;

  return (
    <div className={styles.search} role="search">
      <div className={styles.searchHead}>
        <label className={styles.choiceTitle} htmlFor={fieldId}>
          Найти в базе
        </label>
        {onClose && (
          <button type="button" className={styles.searchClose} aria-label="Закрыть поиск" onClick={onClose}>
            <CloseIcon size={14} stroke={2.4} />
          </button>
        )}
      </div>
      <input
        ref={field}
        id={fieldId}
        type="search"
        className={styles.searchField}
        value={query}
        placeholder={searchHint(language)}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setExpanded(false);
        }}
      />
      <p className={styles.small} role="status">
        {status}
      </p>
      {shown.map((option) => (
        <OptionRow key={option.cardId} option={option} onChoose={() => onChoose(item.id, option)} />
      ))}
      {found.length > shown.length && (
        <button type="button" className={styles.moreOptions} onClick={() => setExpanded(true)}>
          Показать ещё {found.length - shown.length}
        </button>
      )}
      <button type="button" className={cx(styles.option, styles.optionPlain)} onClick={() => onAsPrinted(item.id)}>
        <span className={styles.optionText}>
          <span className={styles.optionName}>Добавить как напечатана</span>
          <span className={styles.small}>Если её нет в базе: обложкой станет фото, цены не будет</span>
        </span>
        <span className={styles.radio} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Missing({
  item,
  onAdd,
  onRetry,
  onChoose,
}: {
  item: ScanItem;
  onAdd: (itemId: string) => void;
  onRetry: (itemId: string) => void;
  /** Карта, найденная своим поиском: «Найти в базе» есть, только если он передан */
  onChoose?: (itemId: string, candidate: Candidate) => void;
}) {
  const { detected } = item;
  const [searching, setSearching] = useState(false);
  let why = 'В базе TCGdex её не нашлось: там есть не все наборы, а новым сетам нужно время.';
  if (item.searchFailed) why = 'Проверь интернет и поищи ещё раз.';
  else if (catalogFor(detected.language).tcgdex === null) why = 'Китайских карт для КНР и корейских в базах карт нет.';
  else if (detected.language === 'ja') {
    why = detected.setCode
      ? 'Её не нашлось ни в TCGdex, ни в Limitless TCG. Проверь, что код сета и номер прочитаны верно.'
      : 'В TCGdex её не нашлось, а без кода сета её не найти в Limitless TCG.';
  }
  return (
    <section className={styles.missingWrap}>
      <div className={styles.missing}>
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
            Её можно добавить как есть: обложкой станет вырезка из фото, она хранится только в этом браузере. Цены у такой
            карты не будет.
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
            {onChoose && !item.searchFailed && !searching && (
              <Button variant="link" start={<SearchIcon size={16} stroke={2} />} onClick={() => setSearching(true)}>
                Найти в базе
              </Button>
            )}
          </div>
        </div>
      </div>
      {onChoose && searching && (
        <CardSearch item={item} onChoose={onChoose} onAsPrinted={onAdd} onClose={() => setSearching(false)} />
      )}
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
