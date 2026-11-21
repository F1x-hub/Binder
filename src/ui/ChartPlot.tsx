import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { longDate, nearestPoint, type Chart } from '@/lib/price-history';
import { cx } from '@/ui/cx';
import styles from './ChartPlot.module.css';

export type ChartMoney = (value: number, kind: 'usd' | 'eur') => string;

type Props = {
  chart: Chart;
  /** Имя ползунка для скринридера: «Стоимость коллекции за 1М» */
  label: string;
  money: ChartMoney;
  /** Высота поля в пикселях: 200 у графика в панели, 64 у маленького в шапке альбома */
  height?: number;
  /** Линии сетки на 40, 100 и 160 из 200 */
  grid?: boolean;
  className?: string;
};

/**
 * Поле графика цены, как на странице карточки: линия и заливка в координатах 600×200
 * (buildChart), кружок на последней цене. Наведение мышью или пальцем показывает
 * вертикальную линию, точку и подсказку с датой и ценой ближайшего дня; у правого края
 * подсказка встаёт слева. С клавиатуры это ползунок по дням: стрелки, Home, End, Esc.
 */
export function ChartPlot({ chart, label, money, height = 200, grid = true, className }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const { points } = chart;
  const last = points.length - 1;
  const point = active === null ? null : (points[active] ?? null);

  const pick = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setActive(nearestPoint(points, ((clientX - rect.left) / rect.width) * 600));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = active ?? last;
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? Math.min(last, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) {
      if (event.key === 'Escape') setActive(null);
      return;
    }
    event.preventDefault();
    setActive(next);
  };

  const summary = `${longDate(points[0]!.day)} — ${longDate(points[last]!.day)}, от ${money(chart.first, chart.currency)} до ${money(chart.last, chart.currency)}`;

  return (
    <div
      ref={plotRef}
      className={cx(styles.plot, className)}
      style={{ height }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={active ?? last}
      aria-valuetext={point ? `${longDate(point.day)}: ${money(point.value, chart.currency)}` : summary}
      onPointerMove={(event) => pick(event.clientX)}
      onPointerDown={(event) => pick(event.clientX)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
      onFocus={() => setActive((current) => current ?? last)}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
    >
      <svg aria-hidden="true" width="100%" height={height} viewBox="0 0 600 200" preserveAspectRatio="none">
        {grid &&
          [40, 100, 160].map((y) => (
            <line key={y} x1="0" y1={y} x2="600" y2={y} className={styles.grid} vectorEffect="non-scaling-stroke" />
          ))}
        <polygon points={chart.area} className={styles.area} />
        <polyline points={chart.line} className={styles.line} vectorEffect="non-scaling-stroke" />
      </svg>
      {point ? (
        <>
          <span className={styles.crosshair} style={{ left: `${point.x / 6}%` }} aria-hidden="true" />
          <span className={styles.hoverDot} style={{ left: `${point.x / 6}%`, top: `${point.y / 2}%` }} aria-hidden="true" />
          <span className={cx(styles.tooltip, point.x > 400 && styles.tooltipLeft)} style={{ left: `${point.x / 6}%` }} aria-hidden="true">
            <span className={styles.tooltipDate}>{longDate(point.day)}</span>
            <span className={styles.tooltipValue}>{money(point.value, chart.currency)}</span>
          </span>
        </>
      ) : (
        <span className={styles.marker} style={{ top: `calc(${chart.endTop}% - 6px)` }} aria-hidden="true" />
      )}
    </div>
  );
}
