import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useLocation } from 'wouter';
import { cardHref, nameLang, namesOf, numberLabel } from '@/app/pages/library/AlbumCard';
import { searchInLibrary } from '@/app/pages/library/useLibraryState';
import { useAuth } from '@/lib/auth-state';
import { CollectionProvider, useOwned } from '@/lib/collection-state';
import { CARD_FORMS, countLabel } from '@/lib/format';
import { joinedLabel, type ClubMember } from '@/lib/friends';
import {
  cardSuggestions,
  isTypingTarget,
  memberSuggestions,
  moveActive,
  resultsAnnouncement,
  suggestionItems,
  type SuggestionItem,
} from '@/lib/header-search';
import { LANGUAGE_LABELS } from '@/lib/languages';
import { MembershipProvider, useMembership } from '@/lib/membership-state';
import { useCardViews, type CardView } from '@/lib/useCardViews';
import { useClubMembers } from '@/lib/useClubMembers';
import { Avatar } from '@/ui/Avatar';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { AlbumIcon, SearchIcon } from '@/ui/Icons';
import styles from './HeaderSearch.module.css';

const PLACEHOLDER = 'Поиск карточек и друзей';

/**
 * Поиск в шапке вкладки: подсказки по своему альбому и по участникам клуба.
 * Поле — combobox по шаблону WAI-ARIA: фокус всегда в поле, выбранную подсказку называет
 * aria-activedescendant. Список — popover="manual" у поля (anchor positioning): открывает
 * и закрывает его свой код, потому что «auto» закрывался бы от щелчка в само поле.
 */
export function HeaderSearch() {
  const auth = useAuth();
  if (auth.status !== 'signed-in') {
    return <Field disabled title={auth.status === 'loading' ? undefined : 'Поиск откроется после входа'} />;
  }
  const { uid } = auth.user;
  // Подписка на свой документ участника — та же, что у AuthGate: Firestore слушает его один раз
  return (
    <MembershipProvider key={uid} uid={uid}>
      <MemberSearch uid={uid} />
    </MembershipProvider>
  );
}

/**
 * Альбом и участники читаются только после первого фокуса в поиске: кто поиском не пользуется,
 * за него не платит. Подписка на альбом та же, что у страниц, — Firestore не читает его второй раз.
 */
function MemberSearch({ uid }: { uid: string }) {
  const membership = useMembership();
  const [active, setActive] = useState(false);
  const member = membership.status === 'member';
  return (
    <CollectionProvider uid={member && active ? uid : null}>
      <SearchBox
        uid={uid}
        member={member}
        blocked={membership.status === 'not-member' || membership.status === 'error'}
        onActivate={() => setActive(true)}
      />
    </CollectionProvider>
  );
}

type Item = SuggestionItem<CardView, ClubMember>;

function SearchBox({
  uid,
  member,
  blocked,
  onActivate,
}: {
  uid: string;
  member: boolean;
  blocked: boolean;
  onActivate: () => void;
}) {
  const [, navigate] = useLocation();
  const baseId = useId();
  const listboxId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  // Esc закрыл подсказки: до следующей буквы или стрелки они не открываются
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Подсказку выбрали стрелкой: у неё кольцо, как у фокуса; под мышью — только подсветка
  const [byKeyboard, setByKeyboard] = useState(false);

  const { cards, ready } = useOwned();
  // Цены поиску не нужны: их грузят страницы альбома
  const views = useCardViews(cards, ready, { prices: false });
  // Участники читаются при фокусе в поле, из памяти, если список свежий (src/lib/useClubMembers.ts)
  const membersState = useClubMembers(member && focused);

  const trimmed = query.trim();
  const cardResult = useMemo(() => (views ? cardSuggestions(views, trimmed) : { cards: [], total: 0 }), [views, trimmed]);
  const memberResult = useMemo(
    () =>
      membersState.status === 'ready' ? memberSuggestions(membersState.members, trimmed, { self: uid }) : { members: [], total: 0 },
    [membersState, trimmed, uid],
  );
  const items = useMemo(() => suggestionItems(cardResult, memberResult), [cardResult, memberResult]);
  const current = activeIndex < items.length ? activeIndex : -1;
  const open = member && focused && !dismissed && trimmed !== '';
  const albumLoading = !views;
  const membersLoading = membersState.status === 'idle' || membersState.status === 'loading';
  const searching = items.length === 0 && (albumLoading || membersLoading);

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const shown = popover.matches(':popover-open');
    if (open && !shown) popover.showPopover();
    if (!open && shown) popover.hidePopover();
  }, [open]);

  // Выбранная стрелкой подсказка не уходит за край списка
  useEffect(() => {
    if (current >= 0 && byKeyboard) document.getElementById(`${baseId}-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, byKeyboard, baseId]);

  // «/» ставит фокус в поиск, если сейчас не печатают в другом поле и не открыто модальное окно
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || event.isComposing) return;
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return;
      if (document.querySelector('dialog:modal')) return;
      const input = inputRef.current;
      if (!input || input.disabled) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const reset = () => {
    setQuery('');
    setActiveIndex(-1);
    setDismissed(false);
  };

  const showInAlbum = () => {
    if (!trimmed) return;
    searchInLibrary(trimmed);
    navigate('/library');
    reset();
  };

  const choose = (item: Item) => {
    if (item.kind === 'all') return showInAlbum();
    navigate(item.kind === 'card' ? cardHref(item.card) : `/u/${encodeURIComponent(item.member.uid)}`);
    reset();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!member || !trimmed) return;
        event.preventDefault();
        setDismissed(false);
        setByKeyboard(true);
        setActiveIndex(moveActive(open ? current : -1, items.length, event.key));
        return;
      }
      case 'Enter': {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        const item = open && current >= 0 ? items[current] : undefined;
        if (item) choose(item);
        else if (member) showInAlbum();
        return;
      }
      case 'Escape': {
        // Своя обработка и у поля type="search": браузер стёр бы текст с первого нажатия
        event.preventDefault();
        if (open) {
          setDismissed(true);
          setActiveIndex(-1);
        } else if (query) {
          reset();
        }
        return;
      }
    }
  };

  const optionProps = (item: Item, index: number) => ({
    id: `${baseId}-${index}`,
    role: 'option' as const,
    'aria-selected': index === current,
    className: styles.option,
    onClick: () => choose(item),
    onPointerMove: () => {
      if (index !== current || byKeyboard) {
        setByKeyboard(false);
        setActiveIndex(index);
      }
    },
  });

  const cardItems = items.flatMap((item, index) => (item.kind !== 'member' ? [{ item, index }] : []));
  const memberItems = items.flatMap((item, index) => (item.kind === 'member' ? [{ item, index }] : []));

  return (
    <>
      <Field
        inputRef={inputRef}
        disabled={blocked}
        title={blocked ? 'Поиск откроется после вступления в клуб' : undefined}
        value={query}
        showKey={!focused && !query}
        inputProps={{
          role: 'combobox',
          'aria-expanded': open && items.length > 0,
          'aria-controls': listboxId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': open && current >= 0 ? `${baseId}-${current}` : undefined,
          onChange: (event) => {
            setQuery(event.target.value);
            setDismissed(false);
            setActiveIndex(-1);
          },
          onKeyDown,
          onFocus: () => {
            setFocused(true);
            onActivate();
          },
          onBlur: () => {
            setFocused(false);
            setActiveIndex(-1);
          },
        }}
      />
      <span role="status" className={styles.srOnly}>
        {open && !searching ? resultsAnnouncement(cardResult.total, memberResult.total) : ''}
      </span>
      {/* Щелчок по списку не уводит фокус из поля: иначе список закрылся бы до выбора */}
      <div
        ref={popoverRef}
        popover="manual"
        className={styles.popover}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <div
          role="listbox"
          id={listboxId}
          aria-label="Подсказки поиска"
          className={cx(styles.listbox, byKeyboard && styles.keyboard)}
          hidden={items.length === 0}
        >
          {cardItems.length > 0 && (
            <Group id={`${baseId}-cards`} title="Карточки в альбоме">
              {cardItems.map(({ item, index }) =>
                item.kind === 'card' ? (
                  <CardOption key={item.key} card={item.card} {...optionProps(item, index)} />
                ) : (
                  <div key={item.key} {...optionProps(item, index)}>
                    <span className={styles.allIcon} aria-hidden="true">
                      <AlbumIcon size={20} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.name}>Показать все в альбоме</span>
                      <span className={styles.meta}>
                        {item.kind === 'all' ? `Нашлось ${countLabel(item.total, CARD_FORMS)}` : ''}
                      </span>
                    </span>
                  </div>
                ),
              )}
            </Group>
          )}
          {memberItems.length > 0 && (
            <Group id={`${baseId}-members`} title="Участники клуба">
              {memberItems.map(({ item, index }) =>
                item.kind === 'member' ? <MemberOption key={item.key} member={item.member} {...optionProps(item, index)} /> : null,
              )}
            </Group>
          )}
        </div>

        {items.length === 0 &&
          (searching ? (
            <p className={styles.note}>Ищу…</p>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Ничего не нашлось</p>
              <p className={styles.note}>
                {ready && cards.length === 0
                  ? 'В альбоме пока нет карточек, поэтому ищутся только участники клуба.'
                  : 'Поиск идёт по имени, номеру и сету карточек твоего альбома и по именам участников клуба.'}
              </p>
            </div>
          ))}

        {items.length > 0 && albumLoading && <p className={styles.note}>Альбом ещё загружается…</p>}
        {items.length > 0 && membersLoading && <p className={styles.note}>Загружаю участников клуба…</p>}
        {membersState.status === 'error' && (
          <p className={styles.note}>Участников клуба не получилось загрузить: проверь интернет.</p>
        )}
        {cardResult.total > 0 && (
          <p className={styles.hint} aria-hidden="true">
            Enter без выбора — все найденные карточки в альбоме
          </p>
        )}
      </div>
    </>
  );
}

function Field({
  inputRef,
  disabled = false,
  title,
  value = '',
  showKey = false,
  inputProps,
}: {
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  title?: string;
  value?: string;
  showKey?: boolean;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'disabled'>;
}) {
  return (
    <label className={cx(styles.field, disabled && styles.fieldDisabled)} title={title}>
      <SearchIcon size={16} stroke={2} />
      <input
        ref={inputRef}
        type="search"
        aria-label="Поиск карточек и участников клуба"
        aria-keyshortcuts="/"
        placeholder={PLACEHOLDER}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={80}
        value={value}
        disabled={disabled}
        readOnly={!inputProps}
        {...inputProps}
      />
      {showKey && !disabled && (
        <span className={styles.key} aria-hidden="true">
          /
        </span>
      )}
    </label>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className={styles.group}>
      <div role="presentation" id={id} className={styles.groupTitle}>
        {title}
      </div>
      {children}
    </div>
  );
}

type OptionProps = {
  id: string;
  role: 'option';
  'aria-selected': boolean;
  className?: string;
  onClick: () => void;
  onPointerMove: () => void;
};

function CardOption({ card, ...props }: { card: CardView } & OptionProps) {
  const names = namesOf(card);
  const meta = [card.setName, numberLabel(card), card.lang !== 'en' ? LANGUAGE_LABELS[card.lang].short : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div {...props}>
      <span className={styles.thumb} aria-hidden="true">
        <CardImage image={card.image} limitless={card.limitless} thumb={card.thumb} name={names.primary} number={numberLabel(card)} />
      </span>
      <span className={styles.text}>
        <span className={styles.name} lang={nameLang(card)}>
          {names.primary}
        </span>
        <span className={styles.meta}>{meta}</span>
      </span>
      {card.count > 1 && <span className={styles.count}>×{card.count}</span>}
    </div>
  );
}

function MemberOption({ member, ...props }: { member: ClubMember } & OptionProps) {
  const joined = joinedLabel(member.joinedAt);
  return (
    <div {...props}>
      <Avatar src={member.photoURL} size={36} />
      <span className={styles.text}>
        <span className={styles.name}>{member.displayName}</span>
        {joined && <span className={styles.meta}>{joined}</span>}
      </span>
    </div>
  );
}
