import { useId, useRef, useState } from 'react';
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
import { CloseIcon, SearchIcon, SlidersIcon } from '@/ui/Icons';
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

const PRICE_OPTIONS: FilterOption<PriceFilter>[] = [
  { value: 'priced', label: 'С ценой' },
  { value: 'unpriced', label: 'Без цены' },
];

/** Один фильтр-список: где он стоит и как его снять. */
type Field = {
  key: Exclude<keyof LibraryFilters, 'query'>;
  label: string;
  /** Пункт «без фильтра» в строке: «Все сеты» */
  all: string;
  /** Он же в панели, где над списком уже есть подпись: «Все» */
  any: string;
  value: string | null;
  options: ReadonlyArray<FilterOption<string>>;
  onChange: (value: string | null) => void;
  /** Главные фильтры стоят в строке на широкой панели, остальные — всегда в «Ещё фильтры» */
  primary: boolean;
};

/**
 * Фильтры альбома. Ширину меряет container query на самой панели:
 * - широкая (от 1100 px): поиск, сет, тип, редкость, печать и сортировка в одну строку,
 *   язык, состояние и цена — в раскрывающейся панели «Ещё фильтры»;
 * - средняя: поиск, кнопка «Фильтры», чипы включённых фильтров и сортировка в одну строку,
 *   все списки — в панели;
 * - узкая (до 600 px): поиск и сортировка, под ними «Фильтры» и чипы — две строки до карт.
 * Чипы показывают включённые фильтры, крестик снимает один, «Сбросить» — все.
 * Язык, состояние и цена показываются, только если делят альбом хотя бы на две части (или уже выбраны).
 */
export function FilterBar({ filters, choices, sort, facetsLoading, onChange, onReset, onSort }: Props) {
  const sortId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const chipsRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = activeFilterCount(filters);

  const fields: Field[] = [
    {
      key: 'set',
      label: 'Сет',
      all: 'Все сеты',
      any: 'Все',
      value: filters.set,
      options: choices.sets,
      onChange: (set) => onChange({ set }),
      primary: true,
    },
    {
      key: 'type',
      label: 'Тип',
      all: facetsLoading && choices.types.length === 0 ? 'Тип: загрузка…' : 'Все типы',
      any: facetsLoading && choices.types.length === 0 ? 'Загрузка…' : 'Все',
      value: filters.type,
      options: choices.types,
      onChange: (type) => onChange({ type }),
      primary: true,
    },
    {
      key: 'rarity',
      label: 'Редкость',
      all: facetsLoading && choices.rarities.length === 0 ? 'Редкость: загрузка…' : 'Любая редкость',
      any: facetsLoading && choices.rarities.length === 0 ? 'Загрузка…' : 'Любая',
      value: filters.rarity,
      options: choices.rarities,
      onChange: (rarity) => onChange({ rarity }),
      primary: true,
    },
    {
      key: 'finish',
      label: 'Печать',
      all: 'Любая печать',
      any: 'Любая',
      value: filters.finish,
      options: choices.finishes,
      onChange: (finish) => onChange({ finish: finish as Variant | null }),
      primary: true,
    },
  ];
  if (choices.langs.length > 1 || filters.lang) {
    fields.push({
      key: 'lang',
      label: 'Язык',
      all: 'Все языки',
      any: 'Все',
      value: filters.lang,
      options: choices.langs,
      onChange: (lang) => onChange({ lang: lang as CardLanguage | null }),
      primary: false,
    });
  }
  if (choices.conditions.length > 1 || filters.condition) {
    fields.push({
      key: 'condition',
      label: 'Состояние',
      all: 'Любое состояние',
      any: 'Любое',
      value: filters.condition,
      options: choices.conditions.map((option) => ({ ...option, label: CONDITION_LABELS[option.value] })),
      onChange: (condition) => onChange({ condition: condition as Condition | null }),
      primary: false,
    });
  }
  if ((choices.priced > 0 && choices.unpriced > 0) || filters.price !== 'any') {
    fields.push({
      key: 'price',
      label: 'Цена',
      all: 'С ценой и без',
      any: 'С ценой и без',
      value: filters.price === 'any' ? null : filters.price,
      options: PRICE_OPTIONS,
      onChange: (price) => onChange({ price: (price as PriceFilter | null) ?? 'any' }),
      primary: false,
    });
  }

  const primary = fields.filter((field) => field.primary);
  const secondary = fields.filter((field) => !field.primary);
  const on = fields.filter((field) => field.value !== null);
  const onSecondary = secondary.filter((field) => field.value !== null).length;

  // Снятый чип пропадает вместе с фокусом: фокус переходит на соседний чип, а если чипов не осталось —
  // на кнопку «Фильтры» (на широкой панели её может не быть — тогда в поиск)
  const removeChip = (field: Field) => {
    field.onChange(null);
    setTimeout(() => {
      const next = chipsRef.current?.querySelector('button');
      const toggle = toggleRef.current;
      const target = next ?? (toggle && toggle.offsetParent !== null ? toggle : searchRef.current);
      target?.focus();
    });
  };

  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.bar, secondary.length === 0 && styles.noSecondary)}
        role="group"
        aria-label="Фильтры альбома"
      >
        <label className={cx(styles.search, filters.query.trim() && styles.searchOn)}>
          <SearchIcon size={16} stroke={2} />
          <input
            ref={searchRef}
            type="search"
            aria-label="Поиск по имени, номеру или сету"
            placeholder="Имя, номер или сет"
            value={filters.query}
            maxLength={80}
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </label>

        {primary.map((field) => (
          <FilterSelect key={field.key} field={field} className={styles.inlineOnly} />
        ))}

        <button
          ref={toggleRef}
          type="button"
          className={cx(styles.toggle, open && styles.toggleOpen)}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersIcon size={16} stroke={2} />
          <span className={styles.wideText}>
            Ещё фильтры
            {onSecondary > 0 && <span className={styles.count}>{onSecondary}</span>}
          </span>
          <span className={styles.narrowText}>
            Фильтры
            {on.length > 0 && <span className={styles.count}>{on.length}</span>}
          </span>
        </button>

        {active > 0 && (
          <ul ref={chipsRef} className={styles.chips} aria-label="Включённые фильтры">
            {on.map((field) => {
              const text = optionLabel(field);
              return (
                <li key={field.key}>
                  <button
                    type="button"
                    className={styles.chipTag}
                    title={`${field.label}: ${text}`}
                    aria-label={`Снять фильтр «${field.label}: ${text}»`}
                    onClick={() => removeChip(field)}
                  >
                    <span className={styles.chipText}>{text}</span>
                    <CloseIcon size={14} stroke={2.2} />
                  </button>
                </li>
              );
            })}
            <li>
              <button type="button" className={styles.reset} onClick={onReset}>
                Сбросить{active > 1 ? ` (${active})` : ''}
              </button>
            </li>
          </ul>
        )}

        <div className={styles.sort}>
          <label htmlFor={sortId} className={styles.sortLabel}>
            Сортировка
          </label>
          <Select
            id={sortId}
            variant="inline"
            value={sort}
            options={SORT_OPTIONS}
            onChange={onSort}
            className={styles.sortSelect}
          />
        </div>
      </div>

      <div id={panelId} className={styles.panel} hidden={!open} role="group" aria-label="Все фильтры">
        {fields.map((field) => (
          <FilterField key={field.key} field={field} />
        ))}
      </div>

      {facetsLoading && (filters.type || filters.rarity) && (
        <p className={styles.note} role="status">
          Тип и редкость ещё подгружаются из базы карт: найденных карточек может стать больше.
        </p>
      )}
    </div>
  );
}

/** Подпись выбранного пункта для чипа; пропавшее из альбома значение — как есть. */
function optionLabel(field: Field): string {
  return field.options.find((option) => option.value === field.value)?.label ?? field.value ?? '';
}

/** Поле в панели «Фильтры»: подпись над списком. Главные поля на широкой панели стоят в строке и здесь скрыты. */
function FilterField({ field }: { field: Field }) {
  const id = useId();
  return (
    <div className={cx(styles.field, field.primary && styles.panelPrimary, field.key === 'set' && styles.fieldSet)}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {field.label}
      </label>
      <FilterSelect field={field} id={id} all={field.any} className={styles.fieldSelect} />
    </div>
  );
}

function FilterSelect({ field, id, all = field.all, className }: { field: Field; id?: string; all?: string; className?: string }) {
  const { label, value, options } = field;
  // Выбранное значение могло пропасть из альбома (последнюю такую карту убрали): пункт остаётся,
  // чтобы было видно, что фильтр включён, и его можно было снять
  const known = value === null || options.some((option) => option.value === value);
  const items: Array<FilterOption<string>> = [
    { value: ALL, label: all },
    ...options,
    ...(known || value === null ? [] : [{ value, label: value }]),
  ];
  return (
    <Select<string>
      id={id}
      aria-label={id ? undefined : label}
      title={label}
      value={value ?? ALL}
      options={items}
      onChange={(next) => field.onChange(next === ALL ? null : next)}
      className={cx(styles.chip, value !== null && styles.chipOn, className)}
    />
  );
}
