import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Link } from 'wouter';
import { binderDb } from '@/lib/db';
import { DECK_SIZE, type DeckReport } from '@/lib/deck-rules';
import { deleteDeck } from '@/lib/decks';
import { cx } from '@/ui/cx';
import { CheckIcon } from '@/ui/Icons';
import { menuFocusTarget } from '@/ui/menu-keys';
import styles from './Decks.module.css';

/** ✓ или ! перед текстом проверки. */
export function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className={styles.ok} aria-hidden="true">
      <CheckIcon size={16} stroke={2.4} />
    </span>
  ) : (
    <span className={styles.warn} aria-hidden="true">
      !
    </span>
  );
}

export function DeckChecks({ report }: { report: DeckReport }) {
  return (
    <ul className={styles.checks} aria-label="Проверка правил">
      {report.checks.map((check) => (
        <li key={check.id} className={styles.check}>
          <CheckMark ok={check.ok} />
          <span>
            <span className={styles.visuallyHidden}>{check.ok ? 'Выполнено: ' : 'Не выполнено: '}</span>
            {check.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DeckTrack({ total }: { total: number }) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label="Карт в колоде"
      aria-valuemin={0}
      aria-valuemax={DECK_SIZE}
      aria-valuenow={total}
    >
      <div className={styles.fill} style={{ width: `${Math.min(100, Math.round((total / DECK_SIZE) * 100))}%` }} />
    </div>
  );
}

/** Ширина, на которой панель колоды уже не помещается справа от карт: тогда — нижняя полоса и «Состав». */
export const NARROW_DECK_QUERY = '(max-width: 1100px)';

/** Совпадает ли медиазапрос сейчас; перерисовка — при смене ширины окна. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * Удаление колоды со второго нажатия, как «−» на последней копии в альбоме:
 * первое нажатие спрашивает, через 4 секунды вопрос снимается сам.
 */
function useDeleteDeck(uid: string, deckId: string, onDeleted?: () => void) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const press = async () => {
    if (!confirming) {
      setConfirming(true);
      setFailed(false);
      return;
    }
    setBusy(true);
    try {
      await deleteDeck(binderDb(), uid, deckId);
      onDeleted?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return { confirming, busy, failed, press: () => void press() };
}

/** «Удалить колоду» текстом внизу панели конструктора. */
export function DeleteDeckButton({ uid, deckId, name, onDeleted }: { uid: string; deckId: string; name: string; onDeleted?: () => void }) {
  const { confirming, busy, failed, press } = useDeleteDeck(uid, deckId, onDeleted);
  const label = confirming ? `Точно удалить колоду ${name}` : `Удалить колоду ${name}`;
  return (
    <button
      type="button"
      className={cx(styles.textButton, confirming && styles.confirming)}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={press}
    >
      {failed ? 'Не удалилась, ещё раз?' : confirming ? 'Удалить?' : 'Удалить колоду'}
    </button>
  );
}

function MoreIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}

/** В Chrome 150+ стрелки внутри меню ведёт атрибут focusgroup, в Chrome 135–149 — свой код. */
const nativeFocusgroup = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

function menuItems(group: HTMLElement | null): HTMLElement[] {
  return group ? [...group.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')] : [];
}

/**
 * Меню «⋯» плитки колоды: «Открыть конструктор» и «Удалить колоду» (со второго нажатия).
 * Как меню аккаунта в шапке: popover="auto" с кнопкой-вызывателем, Esc и клик мимо закрывает браузер.
 */
export function DeckMenu({ uid, deckId, name }: { uid: string; deckId: string; name: string }) {
  const triggerId = useId();
  const menuId = useId();
  const anchor = `--deck-menu-${triggerId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const enterOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const { confirming, busy, failed, press } = useDeleteDeck(uid, deckId);

  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const onToggle = (event: Event) => {
      const opened = (event as ToggleEvent).newState === 'open';
      setOpen(opened);
      if (opened && enterOnOpen.current) menuItems(menu)[0]?.focus();
      enterOnOpen.current = false;
    };
    // Tab увёл фокус из меню — закрываем, иначе оно висело бы над страницей
    const onFocusIn = (event: FocusEvent) => {
      if (!menu.matches(':popover-open')) return;
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !trigger.contains(target)) menu.hidePopover();
    };
    menu.addEventListener('toggle', onToggle);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      menu.removeEventListener('toggle', onToggle);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const next = menuFocusTarget(event.key, items.indexOf(document.activeElement as HTMLElement), items.length, !nativeFocusgroup);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const itemProps = {
    className: styles.menuItem,
    role: nativeFocusgroup ? undefined : 'menuitem',
    tabIndex: nativeFocusgroup ? undefined : -1,
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={cx(styles.iconButton, styles.surfaceButton)}
        style={{ anchorName: anchor } as CSSProperties}
        aria-label={`Действия с колодой ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        commandfor={menuId}
        command="toggle-popover"
        data-deck-menu=""
        onClick={(event: MouseEvent) => {
          enterOnOpen.current = event.detail === 0;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          enterOnOpen.current = true;
          if (menuRef.current?.matches(':popover-open')) menuItems(menuRef.current)[0]?.focus();
          else triggerRef.current?.click();
        }}
      >
        <MoreIcon />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        className={styles.menu}
        style={{ positionAnchor: anchor } as CSSProperties}
        focusgroup="menu nomemory"
        role={nativeFocusgroup ? undefined : 'menu'}
        aria-labelledby={triggerId}
        onKeyDown={onMenuKeyDown}
      >
        <Link href={`/decks/${deckId}`} {...itemProps}>
          Открыть конструктор
        </Link>
        <button
          type="button"
          {...itemProps}
          className={cx(styles.menuItem, confirming && styles.menuDanger)}
          aria-label={confirming ? `Точно удалить колоду ${name}` : undefined}
          disabled={busy}
          data-deck-delete=""
          onClick={press}
        >
          {busy ? 'Удаляем…' : failed ? 'Не удалилась, ещё раз?' : confirming ? 'Нажми ещё раз, чтобы удалить' : 'Удалить колоду'}
        </button>
      </div>
    </>
  );
}
