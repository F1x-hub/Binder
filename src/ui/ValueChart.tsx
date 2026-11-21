import { useState } from 'react';
import { HISTORY_STARTED, changeLabel } from '@/lib/collection-history';
import { formatCardPrice } from '@/lib/format';
import { buildChart, type ChartPeriod, type PricePoint } from '@/lib/price-history';
import type { CardView } from '@/lib/useCardViews';
import { useCollectionHistory } from '@/lib/useCollectionHistory';
import { ChartPlot, type ChartMoney } from '@/ui/ChartPlot';
import { cx } from '@/ui/cx';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import styles from './ValueChart.module.css';

const PERIODS: ChartPeriod[] = ['1М', '6М', '1Г'];

const money: ChartMoney = (value, kind) => formatCardPrice(kind === 'usd' ? { u: value, e: null } : { u: null, e: value });

type Props = {
  /** Карты альбома с ценами (useCardViews): нужны, если history не передана */
  views?: CardView[] | null;
  /** Цены ещё грузятся (useCardViewsState): историю считать рано */
  pricesLoading?: boolean;
  /** Уже загруженная история (useCollectionHistory): так альбом не читает её второй раз */
  history?: PricePoint[] | null;
  /**
   * panel — панель с осями и периодами 1М/6М/1Г (для главной); compact — маленький
   * график за 30 дней без осей, как в шапке альбома в макете.
   */
  variant?: 'panel' | 'compact';
  className?: string;
};

/**
 * График стоимости всего альбома по дням (src/lib/collection-history.ts). Пока точек
 * меньше двух — объяснение, что история копится с 20 ноября 2026.
 */
export function ValueChart({ views = null, pricesLoading = false, history: given, variant = 'panel', className }: Props) {
  const loaded = useCollectionHistory(given === undefined ? views : null, pricesLoading);
  const history = given === undefined ? loaded : given;
  return variant === 'compact' ? (
    <CompactChart history={history} className={className} />
  ) : (
    <PanelChart history={history} className={className} />
  );
}

function CompactChart({ history, className }: { history: PricePoint[] | null; className?: string }) {
  if (history === null) {
    return (
      <SkeletonArea label="Загружаю историю стоимости…" className={cx(styles.compact, className)}>
        <Skeleton height={64} />
      </SkeletonArea>
    );
  }
  const chart = buildChart(history, '1М');
  if (!chart) {
    return <p className={cx(styles.compact, styles.compactNote, className)}>{emptyNote(history, true)}</p>;
  }
  return (
    <div className={cx(styles.compact, className)}>
      <ChartPlot chart={chart} label="Стоимость коллекции за 30 дней" money={money} height={64} grid={false} className={styles.compactPlot} />
    </div>
  );
}

function PanelChart({ history, className }: { history: PricePoint[] | null; className?: string }) {
  const [period, setPeriod] = useState<ChartPeriod>('1М');
  const chart = history ? buildChart(history, period) : null;
  const change = chart?.change ?? null;
  // Карты только с ценой Cardmarket идут отдельным рядом в евро и в долларовый график не входят
  const euroAside = chart?.currency === 'usd' && history?.some((point) => point.eur !== null);

  return (
    <section className={cx(styles.panel, className)} aria-labelledby="value-chart-title">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id="value-chart-title" className={styles.title}>
            Стоимость коллекции
          </h2>
          <span className={cx(styles.subtitle, change !== null && change > 0 && styles.up, change !== null && change < 0 && styles.down)}>
            {change !== null ? changeLabel(change, null) + ' за период' : 'все карточки альбома по ценам каждого дня'}
          </span>
        </div>
        <div role="group" aria-label="Период" className={styles.segmented}>
          {PERIODS.map((item) => (
            <button key={item} type="button" aria-pressed={item === period} onClick={() => setPeriod(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      {history === null ? (
        <SkeletonArea label="Загружаю историю стоимости…">
          <Skeleton height={224} />
        </SkeletonArea>
      ) : chart ? (
        <div>
          <div className={styles.chart}>
            <div className={styles.axis} aria-hidden="true">
              {chart.yLabels.map((value, index) => (
                <span key={index} style={{ top: `${33 + index * 60}px` }}>
                  {money(value, chart.currency)}
                </span>
              ))}
            </div>
            <ChartPlot key={period} chart={chart} label={`Стоимость коллекции за ${period}`} money={money} />
          </div>
          <div className={styles.xAxis} aria-hidden="true">
            {chart.xLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>{emptyNote(history, false)}</p>
      )}
      <p className={styles.source}>
        Сколько стоил бы сегодняшний альбом по ценам каждого дня: TCGplayer и Cardmarket через TCGdex, у японских карт — JustTCG.
        {euroAside ? ' Карты только с ценой Cardmarket считаются отдельно, в евро, и в график не входят.' : ''}
      </p>
    </section>
  );
}

function emptyNote(history: PricePoint[], short: boolean): string {
  const priced = history.some((point) => point.usd !== null || point.eur !== null);
  if (!priced) return 'У карт альбома пока нет цен — графику не из чего строиться.';
  return short
    ? `История стоимости копится с ${HISTORY_STARTED} — график появится через пару дней.`
    : `История стоимости копится с ${HISTORY_STARTED}: Binder записывает цены каждый день, когда карты открывают в клубе. График появится через пару дней.`;
}
