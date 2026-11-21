import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { LimitlessRef } from '@/lib/limitless';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import styles from './TiltCard.module.css';

type Props = {
  image?: string;
  limitless?: LimitlessRef | null;
  thumb?: string | null;
  name: string;
  number?: string;
  /** Голо и реверс блестят сильнее */
  holo?: boolean;
  /** Нажатие открывает просмотр; без него карта просто наклоняется */
  onOpen?: () => void;
  className?: string;
};

/**
 * Большая карта, которая наклоняется за курсором, с бликом там, где курсор. В покое — лёгкий
 * поворот из макета. При «уменьшить движение» в системе и в теме Ретро карта стоит ровно.
 * Позиция курсора — в CSS-переменных, перерисовывается только трансформация.
 */
export function TiltCard({ image, limitless, thumb, name, number, holo = false, onOpen, className }: Props) {
  const ref = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  // Курсор ловит неподвижная сцена, а не сама карта: повёрнутая карта у края уходит из-под
  // курсора, и если слушать её, она дёргается туда-обратно (наклон → уход → покой → снова наклон).
  const move = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const box = stage.current?.getBoundingClientRect();
    if (!box || !ref.current) return;
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    const style = ref.current!.style;
    style.setProperty('--ry', `${((x - 0.5) * 24).toFixed(2)}deg`);
    style.setProperty('--rx', `${((0.5 - y) * 18).toFixed(2)}deg`);
    style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    if (!active) setActive(true);
  };

  const leave = () => {
    const style = ref.current?.style;
    if (!style) return;
    for (const name of ['--rx', '--ry', '--mx', '--my']) style.removeProperty(name);
    setActive(false);
  };

  const content = (
    <>
      <CardImage image={image} limitless={limitless} thumb={thumb} name={name} number={number} quality="high" className={styles.image} />
      <span className={cx(styles.sheen, holo && styles.holo)} aria-hidden="true" />
    </>
  );
  const common = {
    className: cx(styles.card, active && styles.active, onOpen && styles.clickable),
  };

  return (
    <div ref={stage} className={cx(styles.stage, className)} onPointerMove={move} onPointerLeave={leave}>
      {onOpen ? (
        <button
          ref={ref as RefObject<HTMLButtonElement>}
          type="button"
          aria-label={`Рассмотреть карту ${name}`}
          onClick={onOpen}
          {...common}
        >
          {content}
        </button>
      ) : (
        <div ref={ref as RefObject<HTMLDivElement>} {...common}>
          {content}
        </div>
      )}
    </div>
  );
}
