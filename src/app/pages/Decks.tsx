import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import { DECK_SIZE, checkDeck, type DeckCardInfo } from '@/lib/deck-rules';
import { createDeck, defaultDeckName, type Deck } from '@/lib/decks';
import { countLabel, type WordForms } from '@/lib/format';
import { displayNames } from '@/lib/names';
import { useCardViews, type CardView } from '@/lib/useCardViews';
import { deckLines, useDeckInfo } from '@/lib/useDeckInfo';
import { useDecks } from '@/lib/useDecks';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { PlusIcon } from '@/ui/Icons';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import { CheckMark, DeckMenu, DeckTrack } from './DeckParts';
import page from './Page.module.css';
import styles from './Decks.module.css';

/** Колоды участника: список, новая колода, удаление. Конструктор — на #/decks/:id. */
export function Decks() {
  usePageTitle('Колоды');
  const [, navigate] = useLocation();
  const auth = useAuth();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const decksState = useDecks(uid);
  const { cards, ready, error: albumError, retry } = useOwned();
  const views = useCardViews(cards, ready);
  const decks = decksState.status === 'ready' ? decksState.decks : [];
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сведения TCGdex нужны только картам, которые лежат в колодах
  const inDecks = useMemo(() => new Set(decks.flatMap((deck) => Object.keys(deck.cards))), [decks]);
  const deckViews = useMemo(() => (views ? views.filter((view) => inDecks.has(view.docId)) : null), [views, inDecks]);
  const { info, loading } = useDeckInfo(deckViews);
  const byId = useMemo(() => new Map((views ?? []).map((view) => [view.docId, view])), [views]);

  const create = async () => {
    if (!uid) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createDeck(binderDb(), uid, defaultDeckName(decks));
      navigate(`/decks/${id}`);
    } catch {
      setError('Колода не создалась. Проверь интернет и попробуй ещё раз.');
      setCreating(false);
    }
  };

  const newButton = (
    <Button className={styles.newDeck} start={<PlusIcon size={16} stroke={2.2} />} disabled={!uid || creating} onClick={() => void create()}>
      {creating ? 'Создаём…' : 'Новая колода'}
    </Button>
  );

  return (
    <>
      <section className={styles.listHead}>
        <div className={styles.listIntro}>
          <h1 className={page.title}>Колоды</h1>
          <p className={styles.muted}>
            Колода собирается только из карточек твоего альбома: ровно {DECK_SIZE} карт, не больше четырёх с одним именем
            (кроме базовой энергии) и хотя бы один базовый покемон.
          </p>
        </div>
        {decks.length > 0 && newButton}
      </section>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {decksState.status === 'error' ? (
        <EmptyState variant="page" tone="error" title="Колоды не загрузились">
          {decksState.message}
        </EmptyState>
      ) : albumError ? (
        // Без альбома колоды не проверить: вместо «0 из 60» — причина и повтор
        <EmptyState variant="page" tone="error" title="Альбом не загрузился" action={<Button onClick={retry}>Обновить</Button>}>
          {albumError} Колоды собираются из карточек альбома, поэтому без него их не проверить.
        </EmptyState>
      ) : decksState.status === 'loading' || (decks.length > 0 && !ready) ? (
        <DecksSkeleton />
      ) : decks.length === 0 ? (
        <EmptyState variant="page" art="decks" title="Колод пока нет" action={newButton}>
          {cards.length === 0 && ready
            ? 'Сначала добавь карточки в альбом: колода собирается только из них.'
            : 'Собери колоду из карточек альбома: Binder сам проверит правила и подскажет, чего не хватает.'}
        </EmptyState>
      ) : (
        uid && (
          <div className={styles.tiles}>
            {decks.map((deck) => (
              <DeckTile key={deck.id} uid={uid} deck={deck} views={byId} info={info} checking={loading || views === null} />
            ))}
          </div>
        )
      )}
    </>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const POKEMON_FORMS: WordForms = ['покемон', 'покемона', 'покемонов'];
const TRAINER_FORMS: WordForms = ['тренер', 'тренера', 'тренеров'];
const ENERGY_FORMS: WordForms = ['энергия', 'энергии', 'энергий'];

/** Обложка: до трёх карт колоды, сначала покемоны, потом по числу копий. */
function cover(deck: Deck, views: ReadonlyMap<string, CardView>, info: ReadonlyMap<string, DeckCardInfo>): CardView[] {
  const rank = (docId: string) => (info.get(docId)?.category === 'pokemon' ? 0 : 1);
  return Object.entries(deck.cards)
    .filter(([docId]) => views.has(docId))
    .sort(([a, left], [b, right]) => rank(a) - rank(b) || right - left)
    .slice(0, 3)
    .map(([docId]) => views.get(docId)!);
}

function DeckTile({
  uid,
  deck,
  views,
  info,
  checking,
}: {
  uid: string;
  deck: Deck;
  views: ReadonlyMap<string, CardView>;
  info: ReadonlyMap<string, DeckCardInfo>;
  checking: boolean;
}) {
  const report = checkDeck(deckLines(deck.cards, views, info));
  const covers = cover(deck, views, info);
  const counts = [
    countLabel(report.byCategory.pokemon, POKEMON_FORMS),
    countLabel(report.byCategory.trainer, TRAINER_FORMS),
    countLabel(report.byCategory.energy, ENERGY_FORMS),
    report.byCategory.unknown > 0 ? `${report.byCategory.unknown} без данных` : null,
  ].filter(Boolean);

  return (
    <article className={styles.tile}>
      <Link href={`/decks/${deck.id}`} className={styles.tileLink} aria-label={`Колода ${deck.name}: открыть конструктор`}>
        <div className={styles.fan} aria-hidden="true">
          {covers.length > 0 ? (
            covers.map((view) => {
              const names = displayNames(view.name, view.englishName);
              return <CardImage key={view.docId} image={view.image} limitless={view.limitless} thumb={view.thumb} name={names.primary} number={view.localId} />;
            })
          ) : (
            <div className={styles.fanEmpty} />
          )}
        </div>
        <h2 className={styles.tileName}>{deck.name}</h2>
        <div className={styles.progress}>
          <span className={styles.small}>
            {report.total} из {DECK_SIZE} карт{report.total > 0 && !checking ? ` · ${counts.join(' · ')}` : ''}
          </span>
          <DeckTrack total={report.total} />
        </div>
        <p className={styles.tileStatus}>
          {checking && report.total > 0 ? (
            <span className={styles.small}>Проверяем карты по базе…</span>
          ) : (
            <>
              <CheckMark ok={report.ready} />
              <span>{report.ready ? 'Готова к игре' : `Не готова: ${report.problems.map(lowerFirst).join('; ')}`}</span>
            </>
          )}
        </p>
      </Link>
      <div className={styles.tileMenu}>
        <DeckMenu uid={uid} deckId={deck.id} name={deck.name} />
      </div>
    </article>
  );
}

/** Плитки-заглушки, пока грузятся колоды или альбом. */
function DecksSkeleton() {
  return (
    <SkeletonArea label="Загружаю колоды…" className={styles.tiles}>
      {[0, 1, 2].map((index) => (
        <div key={index} className={cx(styles.tile, styles.tileSkeleton)}>
          <div className={styles.fan}>
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} shape="card" />
            ))}
          </div>
          <Skeleton shape="text" width="9em" className={styles.tileName} />
          <div className={styles.progress}>
            <Skeleton shape="text" width="13em" className={styles.small} />
            <Skeleton height={6} />
          </div>
          <Skeleton shape="text" width="8em" className={styles.small} />
        </div>
      ))}
    </SkeletonArea>
  );
}
