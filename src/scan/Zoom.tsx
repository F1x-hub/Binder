import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { cx } from '@/ui/cx';
import styles from './Zoom.module.css';

type Props = {
  /** Что увеличивается: для скринридера («Увеличить: Pikachu ex, 30th Celebration 149») */
  label: string;
  /** Крупная картинка: рисуется, только пока увеличение открыто (большой скан не грузится зря) */
  big: () => ReactNode;
  /** Открыть снаружи: строка варианта в фокусе с клавиатуры показывает обложку крупно */
  active?: boolean;
  /** Кнопка в порядке Tab; у обложки варианта — нет: её открывает фокус на самой строке */
  focusable?: boolean;
  /** Щелчок мышью (не касание): у обложки варианта — выбор этого варианта */
  onMouseClick?: () => void;
  className?: string;
  children: ReactNode;
};

/**
 * Обложка, которую можно рассмотреть: при наведении мышью и при фокусе с клавиатуры рядом
 * встаёт крупная картинка (popover и anchor positioning, как меню аккаунта), на касание —
 * по нажатию, закрывается касанием мимо или по самой картинке, Esc закрывает всегда.
 * На узком экране (поп-ап 380 px, телефон) крупная картинка встаёт поверх, по центру.
 */
export function Zoom({ label, big, active = false, focusable = true, onMouseClick, className, children }: Props) {
  const anchor = `--zoom-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  /** Esc закрыл увеличение, открытое снаружи (фокус на строке): до следующего фокуса не открывать */
  const [muted, setMuted] = useState(false);
  const pointer = useRef('mouse');
  const pop = useRef<HTMLDivElement>(null);
  const open = hovered || focused || tapped || (active && !muted);

  useEffect(() => {
    if (!active) setMuted(false);
  }, [active]);

  useEffect(() => {
    const node = pop.current;
    if (!node?.showPopover) return;
    const shown = node.matches(':popover-open');
    if (open && !shown) node.showPopover();
    if (!open && shown) node.hidePopover();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHovered(false);
      setFocused(false);
      setTapped(false);
      setMuted(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={cx(styles.trigger, className)}
        style={{ anchorName: anchor } as CSSProperties}
        tabIndex={focusable ? undefined : -1}
        aria-label={`Увеличить: ${label}`}
        aria-expanded={open}
        onPointerEnter={(event) => {
          pointer.current = event.pointerType;
          if (event.pointerType === 'mouse') setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHovered(false);
        }}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          // Только с клавиатуры: касание тоже ставит фокус, но там увеличение открывает нажатие
          if (event.currentTarget.matches(':focus-visible')) setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setTapped(false);
        }}
        onClick={() => {
          if (pointer.current === 'mouse') onMouseClick?.();
          else setTapped((value) => !value);
        }}
      >
        {children}
      </button>
      <div
        ref={pop}
        popover="manual"
        className={cx(styles.zoom, tapped && styles.tapped)}
        style={{ positionAnchor: anchor } as CSSProperties}
        onClick={() => setTapped(false)}
      >
        {open && big()}
      </div>
    </>
  );
}
