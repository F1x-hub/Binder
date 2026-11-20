import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { catalog } from '@/lib/catalog';
import { CARD_FORMS, countLabel } from '@/lib/format';
import { htmlLang, type CardLanguage, type TcgdexLanguage } from '@/lib/languages';
import {
  activeFilterCount,
  cardPockets,
  checklistPockets,
  ownedInSet,
  spreadAt,
  spreadCount,
  spreadLabel,
  type ChecklistCard,
  type LibraryFilters,
  type LibrarySort,
  type Pocket,
} from '@/lib/library-filters';
import { isPocketCard } from '@/lib/tcgdex';
import type { CardView } from '@/lib/useCardViews';
import { BackIcon, ForwardIcon } from '@/ui/Icons';
import { AlbumCard } from './AlbumCard';
import styles from './BinderSpread.module.css';
import { NothingFound } from './NothingFound';

const CATALOGS: readonly TcgdexLanguage[] = ['en', 'ja', 'zh-tw', 'id', 'th'];

/** Сет каталога TCGdex из ключа группы альбома («en:sv03»); у карт вне базы («x:ja:MBG») списка нет. */
function catalogSet(key: string | null): { lang: TcgdexLanguage; setId: string } | null {
  if (!key) return null;
  const split = key.indexOf(':');
  const lang = key.slice(0, split) as TcgdexLanguage;
  const setId = key.slice(split + 1);
  return split > 0 && setId && CATALOGS.includes(lang) ? { lang, setId } : null;
}

/** Список карт сета из того же кэша, что у альбома (7 дней). */
function useChecklist(key: string | null): ChecklistCard[] | null {
  const [state, setState] = useState<{ key: string; cards: ChecklistCard[] | null } | null>(null);
  useEffect(() => {
    const set = catalogSet(key);
    if (!key || !set) return;
    let active = true;
    catalog
      .set(set.setId, set.lang)
      .then((detail) => detail.cards.filter((card) => !isPocketCard(card)))
      .catch(() => null)
      .then((cards) => {
        if (active) setState({ key, cards });
      });
    return () => {
      active = false;
    };
  }, [key]);
  return state && state.key === key ? state.cards : null;
}

type Props = {
  /** Карты после фильтров и сортировки */
  cards: CardView[];
  albumSize: number;
  filters: LibraryFilters;
  sort: LibrarySort;
  /** Подпись выбранного сета */
  setTitle: string | null;
  spread: number;
  onSpread: (spread: number) => void;
  onReset: () => void;
  uid: string | null;
};

/**
 * Разворот биндера: две страницы по девять карманов и корешок с кольцами посередине.
 * Если выбран один сет, сортировка по номеру и других фильтров нет, разворот повторяет
 * настоящий биндер сета: все карты по порядку, у недостающих — пустой карман с номером.
 * Иначе карманы заполняются найденными картами подряд. Листается кнопками и стрелками ← →.
 */
export function BinderSpread({ cards, albumSize, filters, sort, setTitle, spread, onSpread, onReset, uid }: Props) {
  const titleId = useId();
  const setMode = filters.set !== null && sort === 'number' && activeFilterCount(filters, { ignoreSet: true }) === 0;
  const checklistKey = setMode && catalogSet(filters.set) ? filters.set : null;
  const checklist = useChecklist(checklistKey);
  const pockets = useMemo(() => (checklist ? checklistPockets(cards, checklist) : cardPockets(cards)), [cards, checklist]);
  const total = spreadCount(pockets.length);
  const index = Math.min(Math.max(0, spread), total - 1);
  const current = spreadAt(pockets, index);

  // Направление перелистывания для анимации; при первом показе страницы не едут
  const flip = useRef<{ index: number; direction: 'none' | 'forward' | 'back' }>({ index, direction: 'none' });
  if (flip.current.index !== index) flip.current = { index, direction: index > flip.current.index ? 'forward' : 'back' };
  const { direction } = flip.current;

  const filtered = activeFilterCount(filters) > 0;
  const title = setTitle ?? (filtered ? 'Подборка по фильтрам' : 'Весь альбом');
  const setTotal = setMode ? (cards[0]?.printedTotal ?? null) : null;
  const countText = setTotal
    ? `${ownedInSet(cards, setTotal)} из ${setTotal} карт`
    : `${countLabel(cards.length, CARD_FORMS)}${filtered ? ` из ${albumSize}` : ''}`;
  const missingLang = checklistKey ? catalogSet(checklistKey)?.lang : undefined;

  const go = (next: number) => onSpread(Math.min(Math.max(0, next), total - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight' && index < total - 1) {
      event.preventDefault();
      go(index + 1);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <span className={styles.muted}>{countText}</span>
        {cards.length > 0 && (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.flip}
              aria-label="Предыдущий разворот"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <BackIcon size={18} stroke={2} />
            </button>
            <span className={styles.pageLabel} aria-live="polite">
              {spreadLabel(current)}
            </span>
            <button
              type="button"
              className={styles.flip}
              aria-label="Следующий разворот"
              disabled={index >= total - 1}
              onClick={() => go(index + 1)}
            >
              <ForwardIcon size={18} stroke={2} />
            </button>
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <NothingFound onReset={onReset} />
      ) : (
        <div className={styles.spreadWrap}>
          <div key={index} className={styles.spread} data-direction={direction}>
            <BinderPage pockets={current.pages[0]!} page={current.first} uid={uid} missingLang={missingLang} />
            <div className={styles.spine} aria-hidden="true">
              <span className={styles.ring} />
              <span className={styles.ring} />
              <span className={styles.ring} />
            </div>
            <BinderPage
              pockets={current.pages[1]!}
              page={current.first + 1}
              empty={current.first === current.last}
              uid={uid}
              missingLang={missingLang}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function BinderPage({
  pockets,
  page,
  empty = false,
  uid,
  missingLang,
}: {
  pockets: Pocket<CardView>[];
  page: number;
  empty?: boolean;
  uid: string | null;
  missingLang: TcgdexLanguage | undefined;
}) {
  return (
    <ul className={styles.page} aria-label={empty ? 'Пустая страница' : `Страница ${page}`}>
      {pockets.map((pocket) => {
        if (pocket.kind === 'card') {
          return (
            <li key={pocket.key} className={styles.slot}>
              <AlbumCard card={pocket.card} uid={uid} />
            </li>
          );
        }
        if (pocket.kind === 'missing') {
          return (
            <li key={pocket.key} className={styles.slot}>
              <div className={styles.pocket} aria-hidden="true">
                {pocket.number}
              </div>
              <div className={styles.missingName}>
                <span lang={missingLang && missingLang !== 'en' ? htmlLang(missingLang as CardLanguage) : undefined}>
                  {pocket.name}
                </span>
                <span className={styles.srOnly}>, номер {pocket.number}, нет в альбоме</span>
              </div>
            </li>
          );
        }
        return (
          <li key={pocket.key} className={styles.slot} aria-hidden="true">
            <div className={styles.pocket} />
          </li>
        );
      })}
    </ul>
  );
}
