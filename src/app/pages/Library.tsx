import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, countLabel, formatCardPrice, formatUsd } from '@/lib/format';
import { filterCards, filterChoices, sortCards, type LibraryView } from '@/lib/library-filters';
import { useCardFacets } from '@/lib/useCardFacets';
import { collectionTotals, useCardViews } from '@/lib/useCardViews';
import { useDecks } from '@/lib/useDecks';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { PlusIcon } from '@/ui/Icons';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import { BinderSpread } from './library/BinderSpread';
import { CardGrid } from './library/CardGrid';
import { CardList } from './library/CardList';
import { FilterBar } from './library/FilterBar';
import { SidePanels } from './library/SidePanels';
import { useLibraryState } from './library/useLibraryState';
import styles from './Page.module.css';
import album from './Library.module.css';

const VIEWS: Array<{ value: LibraryView; label: string }> = [
  { value: 'binder', label: 'Биндер' },
  { value: 'grid', label: 'Сетка' },
  { value: 'list', label: 'Список' },
];

/**
 * Альбом: разворот биндера (по умолчанию), сетка по сетам или список, фильтры и сортировка.
 * Фильтры и открытый разворот хранятся в sessionStorage вкладки, вид — в localStorage.
 * Пока альбом грузится — заглушки в форме выбранного вида, без нулей в шапке;
 * если не загрузился — причина и «Обновить»; пустой — экран со сканером.
 */
export function Library() {
  usePageTitle('Альбом');
  const [, navigate] = useLocation();
  const auth = useAuth();
  const { cards, ready, error, retry } = useOwned();
  const views = useCardViews(cards, ready);
  const { facets, loading: facetsLoading } = useCardFacets(views);
  const { state, setView, setFilters, resetFilters, setSort, setSpread } = useLibraryState();
  const { view, filters, sort } = state;

  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const decks = useDecks(uid);

  const totals = collectionTotals(views ?? cards.map((card) => ({ ...card, price: null })));
  const meta = [
    countLabel(totals.copies, CARD_FORMS),
    countLabel(totals.sets, SET_FORMS),
    // Пока колоды не пришли, их число не показываем, чтобы не мелькал «0 колод»
    decks.status === 'ready' ? countLabel(decks.decks.length, DECK_FORMS) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const all = useMemo(() => views ?? [], [views]);
  const choices = useMemo(() => filterChoices(all, facets), [all, facets]);
  const shown = useMemo(() => sortCards(filterCards(all, facets, filters), sort), [all, facets, filters, sort]);
  const setTitle = filters.set ? (choices.sets.find((option) => option.value === filters.set)?.label ?? null) : null;

  if (error) {
    return (
      <EmptyState variant="page" tone="error" title="Альбом не загрузился" action={<Button onClick={retry}>Обновить</Button>}>
        {error}
      </EmptyState>
    );
  }

  if (ready && cards.length === 0) {
    return (
      <EmptyState
        variant="page"
        art="album"
        title="Альбом пока пуст"
        action={
          <Button start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/scan')}>
            Добавить карточки
          </Button>
        }
      >
        Сфотографируй свои карточки: Binder узнает их и сложит сюда. Сканер есть и здесь, и в окне расширения.
      </EmptyState>
    );
  }

  return (
    <>
      <section className={album.heroRow}>
        <div className={styles.hero}>
          <div className={styles.heroLabel}>Моя коллекция</div>
          {/* Стоимость известна, когда карты разложены; число карточек и сетов — сразу с альбомом */}
          <div className={styles.heroValue}>{views ? formatUsd(totals.value, true) : <Skeleton shape="text" width="4.4em" />}</div>
          {views && totals.euro > 0 && (
            <div className={album.euro}>и {formatCardPrice({ u: null, e: totals.euro })} по ценам Cardmarket</div>
          )}
          <div className={styles.heroMeta}>{ready ? meta : <Skeleton shape="text" width="15em" />}</div>
        </div>
        <div className={album.heroActions}>
          <div className={album.views} role="group" aria-label="Вид альбома">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(album.viewButton, view === option.value && album.viewOn)}
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button className={album.add} start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/scan')}>
            Добавить карточки
          </Button>
        </div>
      </section>

      <FilterBar
        filters={filters}
        choices={choices}
        sort={sort}
        facetsLoading={facetsLoading}
        onChange={setFilters}
        onReset={resetFilters}
        onSort={setSort}
      />
      <div className={album.layout}>
        <div className={album.main}>
          {!views ? (
            <AlbumSkeleton view={view} />
          ) : view === 'binder' ? (
            <BinderSpread
              cards={shown}
              albumSize={all.length}
              filters={filters}
              sort={sort}
              setTitle={setTitle}
              spread={state.spread}
              onSpread={setSpread}
              onReset={resetFilters}
              uid={uid}
            />
          ) : view === 'grid' ? (
            <CardGrid cards={shown} sort={sort} uid={uid} onReset={resetFilters} />
          ) : (
            <CardList cards={shown} sort={sort} uid={uid} onReset={resetFilters} />
          )}
        </div>
        {views ? (
          <SidePanels cards={all} activeSet={filters.set} onPickSet={(set) => setFilters({ set })} />
        ) : (
          <SideSkeleton />
        )}
      </div>
    </>
  );
}

const range = (length: number) => Array.from({ length }, (_, index) => index);

/**
 * Заглушки альбома в форме выбранного вида. Размеры повторяют разворот (BinderSpread),
 * сетку (CardGrid) и список (CardList): когда карты придут, раскладка не прыгает.
 */
function AlbumSkeleton({ view }: { view: LibraryView }) {
  return (
    <SkeletonArea label="Загружаю альбом…" className={album.skeletonPanel}>
      <div className={album.skeletonHead}>
        <Skeleton shape="text" width="7em" className={album.skeletonTitle} />
        <Skeleton shape="text" width="6em" className={album.skeletonSmall} />
        {view === 'binder' && (
          <div className={album.skeletonPager}>
            <Skeleton width={44} height={44} />
            <Skeleton shape="text" width="9em" className={album.skeletonSmall} />
            <Skeleton width={44} height={44} />
          </div>
        )}
      </div>
      {view === 'binder' ? (
        <div className={album.skeletonSpreadWrap}>
          <div className={album.skeletonSpread}>
            <SkeletonPocketPage />
            <div className={album.skeletonSpine}>
              <span className={album.skeletonRing} />
              <span className={album.skeletonRing} />
              <span className={album.skeletonRing} />
            </div>
            <SkeletonPocketPage />
          </div>
        </div>
      ) : view === 'grid' ? (
        <div className={album.skeletonGrid}>
          {range(12).map((index) => (
            <SkeletonSlot key={index} />
          ))}
        </div>
      ) : (
        <div className={album.skeletonList}>
          <div className={album.skeletonListHead}>
            <Skeleton shape="text" width="4em" className={album.skeletonSmall} />
          </div>
          {range(8).map((index) => (
            <div key={index} className={album.skeletonRow}>
              <Skeleton shape="card" width={40} />
              <div className={album.skeletonRowText}>
                <Skeleton shape="text" width="11em" />
                <Skeleton shape="text" width="7em" className={album.skeletonSmall} />
              </div>
              <Skeleton shape="text" width="4em" className={album.skeletonRowPrice} />
            </div>
          ))}
        </div>
      )}
    </SkeletonArea>
  );
}

function SkeletonPocketPage() {
  return (
    <div className={album.skeletonPage}>
      {range(9).map((index) => (
        <SkeletonSlot key={index} />
      ))}
    </div>
  );
}

/** Карта с подписью «имя — цена», как AlbumCard */
function SkeletonSlot() {
  return (
    <div className={album.skeletonSlot}>
      <Skeleton shape="card" />
      <div className={album.skeletonCaption}>
        <Skeleton shape="text" width="62%" />
        <Skeleton shape="text" width="3em" />
      </div>
    </div>
  );
}

/** Боковая колонка, пока карты раскладываются: место под «Прогресс сетов» */
function SideSkeleton() {
  return (
    <div className={album.skeletonSide} aria-hidden="true">
      <div className={album.skeletonSidePanel}>
        <div className={album.skeletonSideHeading}>
          <Skeleton shape="text" width="8em" />
        </div>
        {range(5).map((index) => (
          <div key={index} className={album.skeletonSetRow}>
            <div className={album.skeletonSetLine}>
              <Skeleton shape="text" width={`${[72, 58, 66, 50, 62][index]}%`} />
              <Skeleton shape="text" width="3.5em" />
            </div>
            <Skeleton height={4} />
          </div>
        ))}
      </div>
    </div>
  );
}
