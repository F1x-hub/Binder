import { useId } from 'react';
import type { Condition, Variant } from '@/lib/collection';
import { CONDITION_LABELS } from '@/lib/collection';
import type { CardLanguage } from '@/lib/languages';
import {
  SORT_LABELS,
  activeFilterCount,
  type FilterChoices,
  type FilterOption,
  type LibraryFilters,
  type LibrarySort,
  type PriceFilter,
} from '@/lib/library-filters';
import { cx } from '@/ui/cx';
import { SearchIcon } from '@/ui/Icons';
import { Select } from '@/ui/Select';
import styles from './FilterBar.module.css';

const ALL = '';

type Props = {
  filters: LibraryFilters;
  choices: FilterChoices;
  sort: LibrarySort;
  /** Тип и редкость ещё подгружаются */
  facetsLoading: boolean;
  onChange: (patch: Partial<LibraryFilters>) => void;
  onReset: () => void;
  onSort: (sort: LibrarySort) => void;
};

const SORT_OPTIONS = (Object.keys(SORT_LABELS) as LibrarySort[]).map((sort) => ({ value: sort, label: SORT_LABELS[sort] }));

/**
 * Фильтры альбома в строку, как в макете: выпадающие списки — Select, включённый фильтр
 * подсвечен цветом выбора темы. Язык, состояние и цена показываются, только если делят альбом
 * хотя бы на две части (или уже выбраны).
 */
export function FilterBar({ filters, choices, sort, facetsLoading, onChange, onReset, onSort }: Props) {
  const sortId = useId();
  const active = activeFilterCount(filters);
  const conditionOptions = choices.conditions.map((option) => ({ ...option, label: CONDITION_LABELS[option.value] }));
  const priceOptions: FilterOption<PriceFilter>[] = [
    { value: 'priced', label: 'С ценой' },
    { value: 'unpriced', label: 'Без цены' },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.bar} role="group" aria-label="Фильтры альбома">
        <label className={cx(styles.search, filters.query.trim() && styles.searchOn)}>
          <SearchIcon size={16} stroke={2} />
          <input
            type="search"
            aria-label="Поиск по имени, номеру или сету"
            placeholder="Имя, номер или сет"
            value={filters.query}
            maxLength={80}
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </label>

        <FilterSelect
          label="Сет"
          all="Все сеты"
          value={filters.set}
          options={choices.sets}
          onChange={(set) => onChange({ set })}
        />
        <FilterSelect
          label="Тип"
          all={facetsLoading && choices.types.length === 0 ? 'Тип: загрузка…' : 'Все типы'}
          value={filters.type}
          options={choices.types}
          onChange={(type) => onChange({ type })}
        />
        <FilterSelect
          label="Редкость"
          all={facetsLoading && choices.rarities.length === 0 ? 'Редкость: загрузка…' : 'Любая редкость'}
          value={filters.rarity}
          options={choices.rarities}
          onChange={(rarity) => onChange({ rarity })}
        />
        <FilterSelect<Variant>
          label="Печать"
          all="Любая печать"
          value={filters.finish}
          options={choices.finishes}
          onChange={(finish) => onChange({ finish })}
        />
        {(choices.langs.length > 1 || filters.lang) && (
          <FilterSelect<CardLanguage>
            label="Язык"
            all="Все языки"
            value={filters.lang}
            options={choices.langs}
            onChange={(lang) => onChange({ lang })}
          />
        )}
        {(choices.conditions.length > 1 || filters.condition) && (
          <FilterSelect<Condition>
            label="Состояние"
            all="Любое состояние"
            value={filters.condition}
            options={conditionOptions}
            onChange={(condition) => onChange({ condition })}
          />
        )}
        {((choices.priced > 0 && choices.unpriced > 0) || filters.price !== 'any') && (
          <FilterSelect<PriceFilter>
            label="Цена"
            all="С ценой и без"
            value={filters.price === 'any' ? null : filters.price}
            options={priceOptions}
            onChange={(price) => onChange({ price: price ?? 'any' })}
          />
        )}
        {active > 0 && (
          <button type="button" className={styles.reset} onClick={onReset}>
            Сбросить{active > 1 ? ` (${active})` : ''}
          </button>
        )}

        <div className={styles.sort}>
          <label htmlFor={sortId} className={styles.sortLabel}>
            Сортировка
          </label>
          <Select id={sortId} variant="inline" value={sort} options={SORT_OPTIONS} onChange={onSort} className={styles.sortSelect} />
        </div>
      </div>
      {facetsLoading && (filters.type || filters.rarity) && (
        <p className={styles.note} role="status">
          Тип и редкость ещё подгружаются из базы карт: найденных карточек может стать больше.
        </p>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  /** Пункт «без фильтра» */
  all: string;
  value: T | null;
  options: ReadonlyArray<FilterOption<T>>;
  onChange: (value: T | null) => void;
}) {
  // Выбранное значение могло пропасть из альбома (последнюю такую карту убрали): пункт остаётся,
  // чтобы было видно, что фильтр включён, и его можно было снять
  const known = value === null || options.some((option) => option.value === value);
  const items: Array<FilterOption<T | typeof ALL>> = [
    { value: ALL, label: all },
    ...options,
    ...(known || value === null ? [] : [{ value, label: value }]),
  ];
  return (
    <Select<T | typeof ALL>
      aria-label={label}
      title={label}
      value={value ?? ALL}
      options={items}
      onChange={(next) => onChange(next === ALL ? null : (next as T))}
      className={cx(styles.chip, value !== null && styles.chipOn)}
    />
  );
}
