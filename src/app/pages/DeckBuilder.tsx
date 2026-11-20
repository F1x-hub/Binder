import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import {
  DECK_SIZE,
  addBlocker,
  checkDeck,
  readinessHint,
  unknownInfo,
  type DeckCardInfo,
  type DeckCategory,
  type DeckLine,
  type DeckReport,
} from '@/lib/deck-rules';
import { DECK_LIMITS, cleanDeckName, renameDeck, setDeckCards, withCount, type Deck } from '@/lib/decks';
import { LANGUAGE_LABELS } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import { useCardViews, type CardView } from '@/lib/useCardViews';
import { deckLines, ruleName, useDeckInfo } from '@/lib/useDeckInfo';
import { useDecks } from '@/lib/useDecks';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { BackIcon, CheckIcon, CloseIcon, MinusIcon, PencilIcon, PlusIcon, SearchIcon } from '@/ui/Icons';
import { CheckMark, DeckChecks, DeckTrack, DeleteDeckButton } from './DeckParts';
import page from './Page.module.css';
import styles from './Decks.module.css';

/** Конструктор колоды по макету Deck.dc.html: слева карты альбома, справа колода и проверка правил. */
export function DeckBuilder() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const decksState = useDecks(uid);
  const { cards, ready } = useOwned();
  const views = useCardViews(cards, ready);
  const deck = decksState.status === 'ready' ? (decksState.decks.find((item) => item.id === id) ?? null) : undefined;
  usePageTitle(deck ? deck.name : 'Колода');

  if (decksState.status === 'error') {
    return (
      <p role="alert" className={styles.error}>
        Колода не загрузилась: {decksState.message}
      </p>
    );
  }
  if (deck === null) {
    return (
      <EmptyState
        title="Такой колоды нет"
        action={
          <Link href="/decks" className={styles.textLink}>
            Вернуться к колодам
          </Link>
        }
      >
        Возможно, её только что удалили.
      </EmptyState>
    );
  }
  if (!deck || !uid || !views) return <p className={styles.muted}>Загружаем колоду…</p>;
  return <Builder key={deck.id} uid={uid} deck={deck} views={views} />;
}

type Filter = 'all' | DeckCategory;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'pokemon', label: 'Покемоны' },
  { value: 'trainer', label: 'Тренеры' },
  { value: 'energy', label: 'Энергия' },
];

const ORDER: Record<DeckCategory | 'unknown', number> = { pokemon: 0, trainer: 1, energy: 2, unknown: 3 };

function Builder({ uid, deck, views }: { uid: string; deck: Deck; views: CardView[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [onlyInDeck, setOnlyInDeck] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { info, loading } = useDeckInfo(views);
  const byId = useMemo(() => new Map(views.map((view) => [view.docId, view])), [views]);
  const lines = deckLines(deck.cards, byId, info);
  const report = checkDeck(lines);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = (cards: Record<string, number>) => {
    setError(null);
    setDeckCards(binderDb(), uid, deck.id, cards).catch(() => setError('Колода не сохранилась. Проверь интернет и попробуй ещё раз.'));
  };

  const infoOf = (view: CardView): DeckCardInfo => info.get(view.docId) ?? unknownInfo(ruleName(view));

  const add = (view: CardView) => {
    const blocker = addBlocker(lines, view.docId, infoOf(view), view.count);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    // Больше 60 разных карт (DECK_LIMITS.entries) не набрать: в колоде не больше 60 карт
    save(withCount(deck.cards, view.docId, (deck.cards[view.docId] ?? 0) + 1));
  };

  const remove = (docId: string) => {
    const count = deck.cards[docId] ?? 0;
    if (count > 0) save(withCount(deck.cards, docId, count - 1));
  };

  const needle = query.trim().toLowerCase();
  const pool = views
    .filter((view) => {
      const category = infoOf(view).category;
      if (filter !== 'all' && category !== filter) return false;
      if (onlyInDeck && !deck.cards[view.docId]) return false;
      if (!needle) return true;
      return [view.name, view.englishName ?? ''].some((name) => name.toLowerCase().includes(needle));
    })
    .sort((a, b) => {
      const left = ORDER[infoOf(a).category ?? 'unknown'];
      const right = ORDER[infoOf(b).category ?? 'unknown'];
      return left - right || displayNames(a.name, a.englishName).primary.localeCompare(displayNames(b.name, b.englishName).primary);
    });

  return (
    <>
      <div className={styles.crumbs}>
        <Link href="/decks" className={styles.back}>
          <BackIcon size={18} stroke={2} />
          Колоды
        </Link>
      </div>

      <div className={styles.builder}>
        <section className={styles.pool} aria-labelledby="deck-pool-title">
          <div className={styles.poolHead}>
            <div className={styles.poolTitle}>
              <h1 id="deck-pool-title" className={page.title}>
                Мои карточки
              </h1>
              <span className={styles.muted}>В колоду можно взять только то, что есть в альбоме</span>
            </div>
            <div role="group" aria-label="Категория" className={styles.segmented}>
              {FILTERS.map((item) => (
                <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.toolbar}>
            <label className={styles.search}>
              <SearchIcon size={16} stroke={2} />
              <input
                type="search"
                aria-label="Поиск по моим карточкам"
                placeholder="Найти в моих карточках"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={onlyInDeck} onChange={(event) => setOnlyInDeck(event.target.checked)} />
              Только в колоде
            </label>
          </div>

          <p className={styles.notice} role="status" aria-live="polite">
            {notice ?? (loading ? 'Загружаем из TCGdex категории карт: пока они не пришли, карты видны только во вкладке «Все».' : '')}
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {views.length === 0 ? (
            <EmptyState title="Альбом пуст">Сначала добавь карточки в альбом: колода собирается только из них.</EmptyState>
          ) : pool.length === 0 ? (
            <p className={styles.muted}>{needle ? 'Ничего не нашлось.' : 'В этой категории карт нет.'}</p>
          ) : (
            <div className={styles.grid}>
              {pool.map((view) => (
                <PoolCard
                  key={view.docId}
                  view={view}
                  inDeck={deck.cards[view.docId] ?? 0}
                  blocker={addBlocker(lines, view.docId, infoOf(view), view.count)}
                  unknown={!loading && infoOf(view).category === null}
                  onAdd={() => add(view)}
                  onRemove={() => remove(view.docId)}
                />
              ))}
            </div>
          )}
        </section>

        <DeckPanel uid={uid} deck={deck} lines={lines} report={report} views={byId} loading={loading} onFix={save} />
      </div>
    </>
  );
}

function PoolCard({
  view,
  inDeck,
  blocker,
  unknown,
  onAdd,
  onRemove,
}: {
  view: CardView;
  inDeck: number;
  blocker: string | null;
  unknown: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const names = displayNames(view.name, view.englishName);
  const number = view.printedTotal ? `${view.localId}/${view.printedTotal}` : view.localId;
  const have = [`есть ${view.count}`, view.lang !== 'en' ? LANGUAGE_LABELS[view.lang].short : null, unknown ? 'нет данных' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.poolCard}>
      <div className={styles.poolImage}>
        <CardImage
          image={view.image}
          limitless={view.limitless}
          thumb={view.thumb}
          name={names.primary}
          number={number}
          className={inDeck === 0 ? styles.outOfDeck : undefined}
        />
        {inDeck > 0 && <span className={styles.badge}>в колоде {inDeck}</span>}
      </div>
      <div className={styles.cardText}>
        <span className={styles.cardName} title={names.secondary ?? undefined}>
          {names.primary}
        </span>
        <span className={styles.small}>{have}</span>
      </div>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Убрать ${names.primary} из колоды`}
          disabled={inDeck === 0}
          onClick={onRemove}
        >
          <MinusIcon size={16} stroke={2.2} />
        </button>
        <span className={styles.stepperCount}>{inDeck}</span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Добавить ${names.primary} в колоду`}
          aria-disabled={blocker ? 'true' : undefined}
          title={blocker ?? undefined}
          onClick={onAdd}
        >
          <PlusIcon size={16} stroke={2.2} />
        </button>
      </div>
    </div>
  );
}

type GroupKey = DeckCategory | 'unknown' | 'missing';

const GROUPS: Array<{ key: GroupKey; title: string }> = [
  { key: 'pokemon', title: 'Покемоны' },
  { key: 'trainer', title: 'Тренеры' },
  { key: 'energy', title: 'Энергия' },
  { key: 'unknown', title: 'Без данных' },
  { key: 'missing', title: 'Убраны из альбома' },
];

function DeckPanel({
  uid,
  deck,
  lines,
  report,
  views,
  loading,
  onFix,
}: {
  uid: string;
  deck: Deck;
  lines: DeckLine[];
  report: DeckReport;
  views: ReadonlyMap<string, CardView>;
  loading: boolean;
  onFix: (cards: Record<string, number>) => void;
}) {
  const [, navigate] = useLocation();
  const titleId = useId();
  const label = (line: DeckLine) => {
    const view = views.get(line.docId);
    return view ? displayNames(view.name, view.englishName).primary : line.info.name;
  };
  const groupOf = (line: DeckLine): GroupKey => (views.has(line.docId) ? (line.info.category ?? 'unknown') : 'missing');
  const groups = GROUPS.map((group) => ({
    ...group,
    lines: lines.filter((line) => groupOf(line) === group.key).sort((a, b) => label(a).localeCompare(label(b))),
  })).filter((group) => group.lines.length > 0);

  return (
    <aside className={styles.deck} aria-labelledby={titleId}>
      <DeckName uid={uid} deck={deck} titleId={titleId} />

      <div className={styles.progress}>
        <div className={styles.totalRow}>
          <span className={styles.total}>{report.total}</span>
          <span className={styles.totalOf}>из {DECK_SIZE} карт</span>
        </div>
        <DeckTrack total={report.total} />
      </div>

      <div className={styles.stats}>
        <Stat value={report.byCategory.pokemon} label="покемоны" />
        <Stat value={report.byCategory.trainer} label="тренеры" />
        <Stat value={report.byCategory.energy} label="энергия" />
        {report.byCategory.unknown > 0 && <Stat value={report.byCategory.unknown} label={loading ? 'проверяем' : 'без данных'} />}
      </div>

      <div className={styles.divider} />

      <div className={styles.groups}>
        {groups.length === 0 && <p className={styles.muted}>Колода пуста: добавляй карты кнопкой «+» у карточек.</p>}
        {groups.map((group) => (
          <section key={group.key} className={styles.group} aria-label={group.title}>
            <h3 className={styles.groupTitle}>
              {group.key === 'unknown' && loading ? 'Проверяем по базе' : group.title}
              <span>{group.lines.reduce((sum, line) => sum + line.count, 0)}</span>
            </h3>
            {group.key === 'unknown' && !loading && (
              <p className={styles.groupNote}>
                Этих карт нет в TCGdex и Limitless TCG, поэтому их категория и стадия неизвестны. Они идут в счёт {DECK_SIZE} карт
                и правила четырёх копий (по английскому имени, если оно известно), но базовыми покемонами не считаются. Базовая
                энергия узнаётся по имени.
              </p>
            )}
            {group.lines.map((line) => (
              <div key={line.docId} className={styles.row}>
                <span className={styles.qty}>{line.count} ×</span>
                <span className={styles.rowName}>
                  {label(line)}
                  {line.count > line.owned && (
                    <span className={styles.rowWarn}>
                      {' '}
                      · {line.owned === 0 ? 'нет в альбоме' : `в альбоме ${line.owned}`}
                    </span>
                  )}
                </span>
                {line.count > line.owned && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Оставить в колоде столько ${label(line)}, сколько есть в альбоме`}
                    onClick={() => onFix(withCount(deck.cards, line.docId, line.owned))}
                  >
                    Убрать
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className={styles.divider} />

      {loading && report.total > 0 ? <p className={styles.muted}>Проверяем карты по базе…</p> : <DeckChecks report={report} />}

      <p className={cx(styles.status, report.ready ? styles.ready : styles.notReady)}>
        {report.ready && <CheckMark ok />}
        {loading && report.total > 0 ? 'Проверяем колоду…' : readinessHint(report)}
      </p>

      <div className={styles.deleteRow}>
        <DeleteDeckButton uid={uid} deckId={deck.id} name={deck.name} variant="text" onDeleted={() => navigate('/decks')} />
      </div>
    </aside>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.small}>{label}</span>
    </div>
  );
}

/** Имя колоды и карандаш: правка на месте, Enter сохраняет, Esc отменяет. */
function DeckName({ uid, deck, titleId }: { uid: string; deck: Deck; titleId: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.name);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = () => {
    setDraft(deck.name);
    setFailed(false);
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = cleanDeckName(draft);
    if (!name || name === deck.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await renameDeck(binderDb(), uid, deck.id, name);
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form className={styles.deckHead} onSubmit={(event) => void submit(event)}>
        <div className={styles.deckTitle}>
          <span id={titleId} className={styles.small}>
            Колода
          </span>
          <div className={styles.rename}>
            <input
              aria-label="Название колоды"
              value={draft}
              maxLength={DECK_LIMITS.name}
              autoFocus
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
              }}
            />
            <button type="submit" className={styles.iconButton} aria-label="Сохранить название" disabled={busy}>
              <CheckIcon size={16} stroke={2.2} />
            </button>
            <button type="button" className={styles.iconButton} aria-label="Отменить" disabled={busy} onClick={() => setEditing(false)}>
              <CloseIcon size={16} stroke={2.2} />
            </button>
          </div>
          {failed && (
            <span role="alert" className={styles.error}>
              Не сохранилось. Проверь интернет и попробуй ещё раз.
            </span>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className={styles.deckHead}>
      <div className={styles.deckTitle}>
        <span className={styles.small}>Колода</span>
        <h2 id={titleId} className={styles.deckName}>
          {deck.name}
        </h2>
      </div>
      <button type="button" className={styles.iconButton} aria-label="Переименовать колоду" onClick={start}>
        <PencilIcon size={16} stroke={1.9} />
      </button>
    </div>
  );
}
