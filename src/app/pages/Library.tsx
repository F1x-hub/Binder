import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, countLabel, formatCardPrice, formatUsd } from '@/lib/format';
import { filterCards, filterChoices, sortCards, type LibraryView } from '@/lib/library-filters';
import { useCardFacets } from '@/lib/useCardFacets';
import { collectionTotals, useCardViews } from '@/lib/useCardViews';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { PlusIcon } from '@/ui/Icons';
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
 */
export function Library() {
  usePageTitle('Альбом');
  const [, navigate] = useLocation();
  const auth = useAuth();
  const { cards, ready } = useOwned();
  const views = useCardViews(cards, ready);
  const { facets, loading: facetsLoading } = useCardFacets(views);
  const { state, setView, setFilters, resetFilters, setSort, setSpread } = useLibraryState();
  const { view, filters, sort } = state;

  const totals = collectionTotals(views ?? cards.map((card) => ({ ...card, price: null })));
  const meta = [
    countLabel(totals.copies, CARD_FORMS),
    countLabel(totals.sets, SET_FORMS),
    countLabel(0, DECK_FORMS),
  ].join(' · ');
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;

  const all = useMemo(() => views ?? [], [views]);
  const choices = useMemo(() => filterChoices(all, facets), [all, facets]);
  const shown = useMemo(() => sortCards(filterCards(all, facets, filters), sort), [all, facets, filters, sort]);
  const setTitle = filters.set ? (choices.sets.find((option) => option.value === filters.set)?.label ?? null) : null;
  const empty = ready && cards.length === 0;

  return (
    <>
      <section className={album.heroRow}>
        <div className={styles.hero}>
          <div className={styles.heroLabel}>Моя коллекция</div>
          <div className={styles.heroValue}>{formatUsd(totals.value, true)}</div>
          {totals.euro > 0 && (
            <div className={album.euro}>и {formatCardPrice({ u: null, e: totals.euro })} по ценам Cardmarket</div>
          )}
          <div className={styles.heroMeta}>{meta}</div>
        </div>
        <div className={album.heroActions}>
          {!empty && (
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
          )}
          <Button className={album.add} start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/scan')}>
            Добавить карточки
          </Button>
        </div>
      </section>

      {empty ? (
        <EmptyState title="Альбом пока пуст">
          Сфотографируй свои карточки: Binder узнает их и сложит сюда. Сканер есть и здесь, и в окне расширения.
        </EmptyState>
      ) : (
        <>
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
                <section className={album.loading} aria-busy="true">
                  Раскладываю карточки по страницам…
                </section>
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
            <SidePanels cards={all} activeSet={filters.set} onPickSet={(set) => setFilters({ set })} />
          </div>
        </>
      )}
    </>
  );
}
