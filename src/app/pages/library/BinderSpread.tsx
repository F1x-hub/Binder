import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { catalog } from '@/lib/catalog';
import { setKey } from '@/lib/collection';
import { CARD_FORMS, countLabel } from '@/lib/format';
import { htmlLang, type CardLanguage, type TcgdexLanguage } from '@/lib/languages';
import type { LimitlessRef } from '@/lib/limitless';
import { limitlessChecklist, limitlessSetCards, outOfBaseSet, printedNumberId } from '@/lib/limitless-set';
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
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { BackIcon, ForwardIcon } from '@/ui/Icons';
import { AlbumCard } from './AlbumCard';
import styles from './BinderSpread.module.css';
import { NothingFound } from './NothingFound';

const CATALOGS: readonly TcgdexLanguage[] = ['en', 'ja', 'zh-tw', 'zh-cn', 'ko', 'id', 'th'];

/** Сет каталога TCGdex из ключа группы альбома («en:sv03»); у карт вне базы («x:ja:MBG») списка нет. */
function catalogSet(key: string | null): { lang: TcgdexLanguage; setId: string } | null {
  if (!key) return null;
  const split = key.indexOf(':');
  const lang = key.slice(0, split) as TcgdexLanguage;
  const setId = key.slice(split + 1);
  return split > 0 && setId && CATALOGS.includes(lang) ? { lang, setId } : null;
}

/** Где взять скан карты сета TCGdex в Limitless, если в TCGdex его нет (как у карт альбома в useCardViews). */
function checklistLimitless(lang: TcgdexLanguage, setId: string, abbreviation: string | undefined, localId: string): LimitlessRef | null {
  if (!localId) return null;
  if (lang === 'ja') return { region: 'jp', set: setId, number: localId };
  if (lang === 'en' && abbreviation) return { region: 'en', set: abbreviation, number: localId };
  return null;
}

/**
 * Список карт сета: у сетов TCGdex — из того же кэша, что у альбома (7 дней), у японских сетов
 * вне TCGdex («x:ja:MBG») — из Limitless (src/lib/limitless-set.ts, 30 дней). null — списка нет.
 */
function useChecklist(key: string | null): ChecklistCard[] | null {
  const [state, setState] = useState<{ key: string; cards: ChecklistCard[] | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    const set = catalogSet(key);
    const outside = set ? null : outOfBaseSet(key);
    if (!set && !outside) return;
    let active = true;
    const load: Promise<ChecklistCard[] | null> = set
      ? catalog.set(set.setId, set.lang).then((detail) =>
          detail.cards
            .filter((card) => !isPocketCard(card))
            .map((card) => ({
              id: card.id,
              localId: card.localId,
              name: card.name,
              ...(card.image ? { image: card.image } : {}),
              limitless: checklistLimitless(set.lang, set.setId, detail.abbreviation?.official, card.localId),
            })),
        )
      : limitlessSetCards(outside!).then((cards) => (cards ? limitlessChecklist(cards) : null));
    load
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
 * настоящий биндер сета: все карты по порядку, недостающие — скан без цвета (нет скана — пустой
 * карман с номером). Список сета — из TCGdex, у японских сетов вне TCGdex — из Limitless.
 * Иначе карманы заполняются найденными картами подряд. Листается кнопками и стрелками ← →.
 */
export function BinderSpread({ cards, albumSize, filters, sort, setTitle, spread, onSpread, onReset, uid }: Props) {
  const titleId = useId();
  const setMode = filters.set !== null && sort === 'number' && activeFilterCount(filters, { ignoreSet: true }) === 0;
  const outside = setMode ? outOfBaseSet(filters.set) : null;
  const checklistKey = setMode && (catalogSet(filters.set) || outside) ? filters.set : null;
  const checklist = useChecklist(checklistKey);
  const pockets = useMemo(() => {
    if (!checklist) return cardPockets(cards);
    // Карты вне базы находят карман по напечатанному номеру, карты TCGdex — по ID
    return outside ? checklistPockets(cards, checklist, printedNumberId) : checklistPockets(cards, checklist);
  }, [cards, checklist, outside]);
  // Закладки сетов: только когда карты идут по сетам (сортировка по номеру) и сетов больше одного
  const setStarts = useMemo(() => (!checklist && sort === 'number' ? setStartsOf(pockets) : null), [pockets, checklist, sort]);
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
  // Язык подписи недостающей карты; у японского сета вне базы имя английское, если Limitless знает перевод
  const missingLang: TcgdexLanguage | undefined = checklistKey
    ? (catalogSet(checklistKey)?.lang ?? (outside ? 'ja' : undefined))
    : undefined;

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
            <BinderPage
              pockets={current.pages[0]!}
              page={current.first}
              uid={uid}
              missingLang={missingLang}
              setStarts={setStarts}
            />
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
              setStarts={setStarts}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Карты, с которых начинается новый сет: у них в кармане закладка с именем сета.
 * null — в альбоме один сет, граница не нужна.
 */
function setStartsOf(pockets: readonly Pocket<CardView>[]): ReadonlySet<string> | null {
  const starts = new Set<string>();
  let previous: string | null = null;
  for (const pocket of pockets) {
    if (pocket.kind !== 'card') continue;
    const key = setKey(pocket.card);
    if (key !== previous) starts.add(pocket.key);
    previous = key;
  }
  return starts.size > 1 ? starts : null;
}

function BinderPage({
  pockets,
  page,
  empty = false,
  uid,
  missingLang,
  setStarts,
}: {
  pockets: Pocket<CardView>[];
  page: number;
  empty?: boolean;
  uid: string | null;
  missingLang: TcgdexLanguage | undefined;
  setStarts: ReadonlySet<string> | null;
}) {
  return (
    <ul className={styles.page} aria-label={empty ? 'Пустая страница' : `Страница ${page}`}>
      {pockets.map((pocket, slot) => {
        if (pocket.kind === 'card') {
          // Закладка: начало сета — с чертой, продолжение сета в начале страницы — бледнее
          const starts = setStarts?.has(pocket.key) ?? false;
          const tab = setStarts && (starts || slot === 0) ? pocket.card.setName : null;
          return (
            <li key={pocket.key} className={styles.slot}>
              {setStarts && (
                <span className={cx(styles.setTab, starts && styles.setStart)} title={tab ?? undefined}>
                  {tab}
                </span>
              )}
              <AlbumCard card={pocket.card} uid={uid} />
            </li>
          );
        }
        if (pocket.kind === 'missing') {
          // Английское имя (перевод Limitless) — без lang, напечатанное японское — с ним
          const lang = missingLang && missingLang !== 'en' && !/^[\x20-\x7e]+$/.test(pocket.name) ? missingLang : undefined;
          const emptyPocket = (
            <div className={styles.pocket} aria-hidden="true">
              {pocket.number}
            </div>
          );
          return (
            <li key={pocket.key} className={styles.slot}>
              {/* Скан карты, которой нет в альбоме, — без цвета; нет скана — пустой карман с номером */}
              {pocket.image || pocket.limitless ? (
                <div className={styles.missingCover} aria-hidden="true">
                  <CardImage
                    image={pocket.image}
                    limitless={pocket.limitless}
                    name={pocket.name}
                    fallback={emptyPocket}
                  />
                </div>
              ) : (
                emptyPocket
              )}
              <div className={styles.missingCaption}>
                <span className={styles.missingName} title={pocket.name} lang={lang ? htmlLang(lang as CardLanguage) : undefined}>
                  {pocket.name}
                </span>
                <span className={styles.missingNumber} aria-hidden="true">
                  № {pocket.number}
                </span>
                <span className={styles.srOnly}>, номер {pocket.number}, нет в альбоме</span>
              </div>
            </li>
          );
        }
        return (
          <li key={pocket.key} className={styles.slot} aria-hidden="true">
            {setStarts && <span className={styles.setTab} />}
            <div className={styles.pocket} />
            {/* Место под подпись, как у карты: ряды обеих страниц одной высоты */}
            <div className={styles.missingCaption} />
          </li>
        );
      })}
    </ul>
  );
}
