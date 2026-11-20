import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { buildFeed, groupTitle, type FeedEvent, type FeedSource } from '@/lib/feed';
import { countLabel, timeAgo, type WordForms } from '@/lib/format';
import type { ClubMember } from '@/lib/friends';
import { htmlLang } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import type { CardView } from '@/lib/useCardViews';
import { Avatar } from '@/ui/Avatar';
import { CardImage } from '@/ui/CardImage';
import { ChevronDownIcon } from '@/ui/Icons';
import { cx } from '@/ui/cx';
import { numberLabel } from './ProfileParts';
import styles from './FeedPanel.module.css';

export type FeedOwner = Pick<ClubMember, 'uid' | 'displayName' | 'photoURL'>;
export type FeedItem = FeedEvent<FeedOwner, CardView>;

/** Сколько событий показывать сразу и сколько добавляет «Показать ещё». */
const PAGE = 8;
/** Сколько карт показывать в раскрытом событии: остальные — в коллекции профиля. */
const GROUP_LIMIT = 24;
/** Сколько миниатюр стопкой у свёрнутого события. */
const STACK = 3;

const CARD_WORDS: WordForms = ['карта', 'карты', 'карт'];

const fullDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' });

/** Сет карты для ленты: у карты вне базы без кода сета его нет. */
function setLabel(view: CardView): string | null {
  return view.printed && !view.printed.setCode ? null : view.setName;
}

/** «MBG · 003/021», «Surging Sparks · 238/191». */
function cardDetail(view: CardView): string {
  return [setLabel(view), numberLabel(view)].filter(Boolean).join(' · ');
}

/** Текущее время раз в минуту: «только что» само становится «2 минуты назад». */
function useNow(every = 60 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

type Props = {
  title: string;
  note?: string;
  /** Альбомы, из которых собирается лента; null — ещё загружаются */
  sources: ReadonlyArray<FeedSource<FeedOwner, CardView>> | null;
  /** Лента нескольких участников: у события аватар со ссылкой в профиль и имя */
  showOwner?: boolean;
  /** Своя карта: ссылка на её страницу */
  href?: (view: CardView) => string;
  /** Чужая карта: просмотр во весь экран */
  onOpen?: (owner: FeedOwner, view: CardView) => void;
  /** Что написать, если событий нет */
  empty: string;
  /** Например, что часть альбомов не загрузилась и лента неполная */
  warning?: string | null;
};

/**
 * Лента «кто что добавил» по макету Profile: правая колонка профиля и страницы «Друзья».
 * События собирает src/lib/feed.ts из уже загруженных альбомов, своих чтений у ленты нет.
 */
export function FeedPanel({ title, note, sources, showOwner = false, href, onOpen, empty, warning }: Props) {
  const titleId = useId();
  const now = useNow();
  const events = useMemo(() => (sources ? buildFeed(sources) : null), [sources]);
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      {events === null ? (
        <p className={styles.note}>Загружаем ленту…</p>
      ) : events.length === 0 ? (
        <p className={styles.note}>{empty}</p>
      ) : (
        <ol className={styles.list}>
          {events.slice(0, limit).map((event) => (
            <FeedRow
              key={event.key}
              event={event}
              now={now}
              showOwner={showOwner}
              href={href}
              onOpen={onOpen}
              expanded={expanded.has(event.key)}
              onToggle={() => toggle(event.key)}
            />
          ))}
        </ol>
      )}
      {warning && <p className={styles.note}>{warning}</p>}
      {events && events.length > limit && (
        <button type="button" className={styles.more} onClick={() => setLimit((shown) => shown + PAGE)}>
          Показать ещё
        </button>
      )}
    </section>
  );
}

type RowProps = {
  event: FeedItem;
  now: number;
  showOwner: boolean;
  href?: (view: CardView) => string;
  onOpen?: (owner: FeedOwner, view: CardView) => void;
  expanded: boolean;
  onToggle: () => void;
};

function FeedRow({ event, now, showOwner, href, onOpen, expanded, onToggle }: RowProps) {
  const listId = useId();
  const { owner, cards } = event;
  const single = cards.length === 1;
  const first = cards[0];
  if (!first) return null;
  const names = displayNames(first.name, first.englishName);
  const rest = cards.length - GROUP_LIMIT;

  const when = (
    <time dateTime={new Date(event.at).toISOString()} title={fullDate.format(event.at)}>
      {timeAgo(event.at, now)}
    </time>
  );
  // Без глагола: «добавила» или «добавил» по имени не угадать, поэтому «Ника: новая карта …»
  const who = showOwner ? (
    <>
      <span className={styles.who}>{owner.displayName}</span>:{' '}
    </>
  ) : null;

  const text = single ? (
    <span className={styles.text}>
      <span className={styles.what}>
        {who}
        {showOwner && 'новая карта '}
        <span className={cx(!showOwner && styles.strong)} lang={names.secondary ? undefined : htmlLang(first.lang)}>
          {names.primary}
        </span>
      </span>
      <span className={styles.meta}>
        {cardDetail(first)} · {when}
      </span>
    </span>
  ) : (
    <span className={styles.text}>
      <span className={styles.what}>
        {who}
        {groupTitle(cards.map(setLabel))}
      </span>
      <span className={styles.meta}>
        {when} ·{' '}
        <span className={styles.toggle}>
          {expanded ? 'скрыть' : 'показать'}
          <span className={cx(styles.chevron, expanded && styles.chevronOpen)}>
            <ChevronDownIcon size={14} stroke={2.25} />
          </span>
        </span>
      </span>
    </span>
  );

  const stack = cards.slice(0, STACK);
  const thumbs = (
    // Миниатюры только для глаз: имя карты уже есть в тексте события
    <span className={styles.stack} style={{ '--n': stack.length } as CSSProperties} aria-hidden="true">
      {stack.map((view, index) => {
        const thumbNames = displayNames(view.name, view.englishName);
        return (
          <span key={view.docId} className={styles.thumb} style={{ '--i': index, zIndex: STACK - index } as CSSProperties}>
            <CardImage
              image={view.image}
              limitless={view.limitless}
              thumb={view.thumb}
              name={thumbNames.primary}
              number={numberLabel(view)}
            />
          </span>
        );
      })}
    </span>
  );

  let main: ReactNode;
  if (!single) {
    main = (
      <button type="button" className={styles.main} aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
        {text}
        {thumbs}
      </button>
    );
  } else if (href) {
    main = (
      <Link href={href(first)} className={styles.main}>
        {text}
        {thumbs}
      </Link>
    );
  } else {
    main = (
      <button type="button" className={styles.main} onClick={() => onOpen?.(owner, first)}>
        {text}
        {thumbs}
      </button>
    );
  }

  return (
    <li className={styles.event}>
      <div className={styles.row}>
        {showOwner && (
          <Link href={`/u/${owner.uid}`} className={styles.avatar} aria-label={`Профиль: ${owner.displayName}`}>
            <Avatar src={owner.photoURL} size={32} />
          </Link>
        )}
        {main}
      </div>
      {!single && (
        <div id={listId} className={cx(styles.group, showOwner && styles.groupIndent)} hidden={!expanded}>
          <ul className={styles.cards}>
            {cards.slice(0, GROUP_LIMIT).map((view) => (
              <li key={view.docId}>
                <GroupTile view={view} href={href} onOpen={onOpen ? () => onOpen(owner, view) : undefined} />
              </li>
            ))}
          </ul>
          {rest > 0 &&
            (showOwner ? (
              <Link href={`/u/${owner.uid}`} className={styles.restLink}>
                Ещё {countLabel(rest, CARD_WORDS)} — в профиле
              </Link>
            ) : (
              <p className={styles.note}>Ещё {countLabel(rest, CARD_WORDS)} — во вкладке «Коллекция»</p>
            ))}
        </div>
      )}
    </li>
  );
}

/** Карта раскрытого события: своя ведёт на страницу карточки, чужая открывает просмотр. */
function GroupTile({ view, href, onOpen }: { view: CardView; href?: (view: CardView) => string; onOpen?: () => void }) {
  const names = displayNames(view.name, view.englishName);
  const number = numberLabel(view);
  const image = (
    <CardImage image={view.image} limitless={view.limitless} thumb={view.thumb} name={names.primary} number={number} />
  );
  const label = `${names.primary}, ${number}`;
  return href ? (
    <Link href={href(view)} className={styles.tile} aria-label={`${label}: открыть карточку`} title={names.primary}>
      {image}
    </Link>
  ) : (
    <button type="button" className={styles.tile} aria-label={`${label}: рассмотреть`} title={names.primary} onClick={onOpen}>
      {image}
    </button>
  );
}
