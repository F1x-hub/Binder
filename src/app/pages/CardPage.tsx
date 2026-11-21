import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import {
  factsFromLimitless,
  factsFromTcgdex,
  withTranslation,
  type CardFacts,
  type Energy,
} from '@/lib/card-facts';
import { loadCardMarket, type GradedPrice, type MarketResult } from '@/lib/card-market';
import { catalog } from '@/lib/catalog';
import {
  CONDITIONS,
  CONDITION_LABELS,
  addOne,
  friendsWithCard,
  removeOne,
  setCondition,
  type Condition,
  type Owner,
} from '@/lib/collection';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import { CARD_FORMS, countLabel, formatCardPrice, rarityLabel } from '@/lib/format';
import { LANGUAGE_LABELS, htmlLang } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import { japaneseCardText } from '@/lib/limitless';
import {
  PERIOD_MONTHS,
  buildChart,
  loadPriceHistory,
  longDate,
  nearestPoint,
  shortDate,
  type Chart,
  type ChartPeriod,
  type PricePoint,
} from '@/lib/price-history';
import { utcDay } from '@/lib/prices';
import { removeThumb } from '@/lib/thumbnails';
import { useCardViews, type CardView } from '@/lib/useCardViews';
import { Avatar } from '@/ui/Avatar';
import { CardViewer } from '@/ui/CardViewer';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { BackIcon, MinusIcon, PlusIcon, ScanIcon } from '@/ui/Icons';
import { Select } from '@/ui/Select';
import { TiltCard } from '@/ui/TiltCard';
import { AddToDeck } from './AddToDeck';
import { ConditionGrader } from './ConditionGrader';
import styles from './CardPage.module.css';

/** Страница карточки своего альбома: большая карта, всё, что на ней написано, цены и у кого ещё есть. */
export function CardPage() {
  const { id } = useParams<{ id: string }>();
  const docId = decodeURIComponent(id);
  const auth = useAuth();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const { byId, ready } = useOwned();
  const card = byId.get(docId) ?? null;
  const list = useMemo(() => (card ? [card] : []), [card]);
  const views = useCardViews(list, ready);
  const view = views?.[0] ?? null;
  usePageTitle(view ? displayNames(view.name, view.englishName).primary : 'Карточка');

  if (ready && !card) {
    return (
      <EmptyState
        title="Этой карточки нет в альбоме"
        action={
          <Link href="/library" className={styles.textLink}>
            Вернуться в альбом
          </Link>
        }
      >
        Возможно, её только что убрали.
      </EmptyState>
    );
  }
  if (!view || !uid) return <p className={styles.muted}>Загружаем карточку…</p>;
  return <CardDetails view={view} uid={uid} />;
}

/** Номер как на карте: у карты вне базы — напечатанный («003/021»), у карты из базы — из сета. */
function numberLabel(view: CardView): string {
  if (view.printed) return view.printed.total ? `${view.printed.number}/${view.printed.total}` : view.printed.number;
  return view.printedTotal ? `${view.localId}/${view.printedTotal}` : view.localId;
}

const releaseFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function CardDetails({ view, uid }: { view: CardView; uid: string }) {
  const [viewer, setViewer] = useState(false);
  const [photo, setPhoto] = useState<'scan' | 'mine'>('scan');
  const text = useCardText(view);
  const hasScan = Boolean(view.image || view.limitless);
  const canToggle = hasScan && Boolean(view.thumb);
  const showMine = canToggle ? photo === 'mine' : !hasScan;
  const holo = view.variant === 'holo' || view.variant === 'reverse';
  // Английское имя — главным, напечатанное (японское) — подписью под ним
  const names = displayNames(view.name, view.englishName);
  const image = {
    image: showMine ? undefined : view.image,
    limitless: showMine ? null : view.limitless,
    thumb: view.thumb,
    name: names.primary,
    number: numberLabel(view),
    holo,
  };
  const facts = text.facts;
  const meta = [view.setName, numberLabel(view), facts?.illustrator ? `иллюстрация: ${facts.illustrator}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className={styles.crumbs}>
        <Link href="/library" className={styles.back}>
          <BackIcon size={18} stroke={2} />
          Альбом
        </Link>
        <span className={styles.muted}>
          {view.setName} / {view.localId}
        </span>
      </div>

      <div className={styles.layout}>
        <div className={styles.left}>
          <TiltCard {...image} onOpen={() => setViewer(true)} />
          <p className={styles.hint}>Наведи курсор, чтобы покрутить карту, нажми — чтобы рассмотреть</p>
          {canToggle && (
            <div role="group" aria-label="Какое фото показывать" className={styles.segmented}>
              <button type="button" aria-pressed={photo === 'scan'} onClick={() => setPhoto('scan')}>
                Официальный скан
              </button>
              <button type="button" aria-pressed={photo === 'mine'} onClick={() => setPhoto('mine')}>
                Моё фото
              </button>
            </div>
          )}
          <CollectionPanel view={view} uid={uid} />
          <AddToDeck view={view} uid={uid} />
        </div>

        <div className={styles.right}>
          <div className={styles.heading}>
            <div className={styles.tags}>
              {facts?.types.map((type) => (
                <span key={type.type} className={styles.tag}>
                  <EnergyDot energy={type} />
                  {type.label}
                </span>
              ))}
              {facts?.rarity && <span className={styles.tag}>{rarityLabel(facts.rarity)}</span>}
              {view.variant === 'holo' && <span className={styles.tag}>Голо</span>}
              {view.variant === 'reverse' && <span className={styles.tag}>Реверс</span>}
              <span className={styles.tag}>{LANGUAGE_LABELS[view.lang].card}</span>
            </div>
            <h1 className={styles.name} lang={names.secondary ? undefined : htmlLang(view.lang)}>
              {names.primary}
            </h1>
            {names.secondary && (
              <p className={styles.original} lang={htmlLang(view.lang)}>
                {names.secondary}
              </p>
            )}
            <p className={styles.meta}>{meta}</p>
          </div>

          <PricePanel view={view} />
          <FactsPanel view={view} text={text} />
          <FriendsPanel uid={uid} docId={view.docId} />
        </div>
      </div>

      <CardViewer open={viewer} label={`Карта ${names.primary}`} onClose={() => setViewer(false)}>
        <TiltCard {...image} className={styles.viewerCard} />
        <p className={styles.viewerCaption}>
          {names.primary} · {numberLabel(view)}
        </p>
      </CardViewer>
    </>
  );
}

/** Счётчик копий и состояние карты: меняет только хозяин альбома. */
function CollectionPanel({ view, uid }: { view: CardView; uid: string }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const conditionId = useId();

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch {
      setError('Не получилось сохранить. Проверь интернет и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const decrement = () => {
    if (view.count === 1 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void run(async () => {
      if ((await removeOne(binderDb(), uid, view)) === 'deleted') {
        await removeThumb(view.docId).catch(() => undefined);
        navigate('/library');
      }
    });
  };

  return (
    <div className={styles.collection}>
      <div className={styles.collectionRow}>
        <span>В коллекции</span>
        <div className={styles.stepper}>
          <button
            type="button"
            className={cx(styles.iconButton, confirming && styles.confirming)}
            aria-label={confirming ? `Точно убрать ${displayNames(view.name, view.englishName).primary} из альбома` : view.count === 1 ? 'Убрать из альбома' : 'Убрать одну'}
            disabled={busy}
            onClick={decrement}
          >
            {confirming ? 'Убрать?' : <MinusIcon size={16} stroke={2.2} />}
          </button>
          <span className={styles.count}>{view.count}</span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Добавить одну"
            disabled={busy || view.count >= 999}
            onClick={() => void run(() => addOne(binderDb(), uid, view.docId))}
          >
            <PlusIcon size={16} stroke={2.2} />
          </button>
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.collectionRow}>
        <label htmlFor={conditionId}>Состояние</label>
        <Select
          id={conditionId}
          variant="inline"
          value={view.condition ?? 'NM'}
          options={CONDITION_OPTIONS}
          disabled={busy}
          onChange={(condition) => void run(() => setCondition(binderDb(), uid, view.docId, condition))}
        />
      </div>
      <button type="button" className={styles.gradeButton} onClick={() => setGrading(true)}>
        <ScanIcon size={18} stroke={1.9} />
        Оценить состояние по фото
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ConditionGrader
        open={grading}
        name={displayNames(view.name, view.englishName).primary}
        current={view.condition ?? 'NM'}
        onClose={() => setGrading(false)}
        onSave={(condition) => run(() => setCondition(binderDb(), uid, view.docId, condition))}
      />
    </div>
  );
}

const CONDITION_OPTIONS = CONDITIONS.map((condition) => ({ value: condition, label: CONDITION_LABELS[condition] }));

function EnergyDot({ energy }: { energy: Energy }) {
  return <span className={styles.energy} style={{ '--energy': energy.color } as CSSProperties} role="img" aria-label={energy.label} title={energy.label} />;
}

/** Текст карты: оригинал из TCGdex или Limitless и английский перевод японских карт из Limitless. */
type CardText = { facts: CardFacts | null; original: CardFacts | null; translation: CardFacts | null; serie: string | null; loading: boolean };

function useCardText(view: CardView): CardText & { mode: 'translation' | 'original'; setMode: (mode: 'translation' | 'original') => void } {
  const [state, setState] = useState<Omit<CardText, 'facts'>>({ original: null, translation: null, serie: null, loading: true });
  const [mode, setMode] = useState<'translation' | 'original'>('translation');
  // Карта вне TCGdex берёт текст из Limitless, только когда её имя там сверено
  const limitlessSet = view.catalog === 'ja' ? view.setId : view.printed && view.limitless ? view.limitless.set : null;
  const limitlessNumber = view.catalog === 'ja' ? view.localId : view.limitless?.number ?? null;

  useEffect(() => {
    let active = true;
    void (async () => {
      let original: CardFacts | null = null;
      let serie: string | null = null;
      if (view.cardId && view.catalog) {
        const [detail, set] = await Promise.all([
          catalog.card(view.cardId, view.catalog).catch(() => null),
          catalog.set(view.setId, view.catalog).catch(() => null),
        ]);
        if (detail) original = factsFromTcgdex(detail);
        serie = set?.serie?.name ?? null;
      }
      let translation: CardFacts | null = null;
      if (limitlessSet && limitlessNumber) {
        const text = await japaneseCardText(limitlessSet, limitlessNumber).catch(() => null);
        if (text) {
          original ??= factsFromLimitless(text.original);
          if (text.english) translation = factsFromLimitless(text.english);
        }
      }
      if (active) setState({ original, translation, serie, loading: false });
    })();
    return () => {
      active = false;
    };
  }, [view.docId, view.cardId, view.catalog, view.setId, limitlessSet, limitlessNumber]);

  const { original, translation } = state;
  const facts =
    mode === 'translation' && translation ? withTranslation(original ?? translation, translation) : (original ?? translation);
  return { ...state, facts, mode, setMode };
}

const PERIODS: ChartPeriod[] = ['1М', '6М', '1Г'];

function percent(change: number): string {
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '';
  return `${sign} ${Math.abs(Math.round(change * 100))}%`.trim();
}

/**
 * Цены и история цены. История за год — из JustTCG (по ключам клуба); пока её нет,
 * график строится по истории, которую клуб копит сам с 20 ноября 2026.
 */
function PricePanel({ view }: { view: CardView }) {
  const [clubHistory, setClubHistory] = useState<PricePoint[] | null>(null);
  const [period, setPeriod] = useState<ChartPeriod>('1М');
  const market = useCardMarket(view);

  useEffect(() => {
    let active = true;
    void loadPriceHistory(binderDb(), view, PERIOD_MONTHS['1Г'])
      .catch(() => [])
      .then((points) => active && setClubHistory(points));
    return () => {
      active = false;
    };
  }, [view.docId, view.price?.u, view.price?.e]);

  const marketHistory = market?.market?.history ?? [];
  const fromMarket = marketHistory.length >= 2;
  const history = fromMarket ? marketHistory : clubHistory;
  const chart = history ? buildChart(history, period) : null;
  const monthChart = history ? buildChart(history, '1М') : null;
  const monthChange = market?.market?.change30 ?? monthChart?.change ?? null;
  const price = view.price;
  const each = price?.u ?? price?.e ?? null;
  const currency = price?.u != null ? 'usd' : 'eur';
  const total = each === null ? null : Math.round(each * view.count * 100) / 100;
  const money = (value: number, kind: 'usd' | 'eur') => formatCardPrice(kind === 'usd' ? { u: value, e: null } : { u: null, e: value });
  const unpricedReason = view.approximate
    ? 'это похожая карта, а не твоя'
    : view.printed && !view.catalog && view.lang !== 'ja'
      ? 'карты нет в базе цен'
      : 'цены пока нет';

  return (
    <>
      <div className={styles.prices}>
        <div className={styles.priceCell}>
          <span className={styles.priceLabel}>Без грейда, Near Mint</span>
          <span className={styles.priceValue}>{price ? formatCardPrice(price) : '—'}</span>
          <span
            className={cx(
              styles.priceChange,
              monthChange == null ? styles.neutral : monthChange < 0 && styles.down,
            )}
          >
            {price
              ? monthChange != null
                ? `${percent(monthChange)} за месяц`
                : 'изменение появится через несколько дней'
              : unpricedReason}
          </span>
        </div>
        {price?.u != null && price.e != null && (
          <div className={styles.priceCell}>
            <span className={styles.priceLabel}>Cardmarket, тренд</span>
            <span className={styles.priceValue}>{formatCardPrice({ u: null, e: price.e })}</span>
            <span className={cx(styles.priceChange, styles.neutral)}>в евро</span>
          </div>
        )}
        {/* При одной копии сумма совпала бы с ценой карты */}
        {total !== null && view.count > 1 && (
          <div className={styles.priceCell}>
            <span className={styles.priceLabel}>Мои копии: {view.count}</span>
            <span className={styles.priceValue}>{money(total, currency)}</span>
            <span className={cx(styles.priceChange, styles.neutral)}>по текущей цене</span>
          </div>
        )}
      </div>

      <section className={styles.panel} aria-labelledby={`${view.docId}-history`}>
        <div className={styles.panelHead}>
          <div>
            <h2 id={`${view.docId}-history`} className={styles.panelTitle}>
              История цены
            </h2>
            <span className={styles.muted}>
              {chart?.change != null ? `без грейда, ${percent(chart.change)} за период` : 'без грейда'}
            </span>
          </div>
          <div role="group" aria-label="Период" className={cx(styles.segmented, styles.periods)}>
            {PERIODS.map((item) => (
              <button key={item} type="button" aria-pressed={item === period} onClick={() => setPeriod(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        {chart ? (
          <>
            <div className={styles.chart}>
              <div className={styles.axis} aria-hidden="true">
                {chart.yLabels.map((value, index) => (
                  <span key={index} style={{ top: `${33 + index * 60}px` }}>
                    {money(value, chart.currency)}
                  </span>
                ))}
              </div>
              <ChartPlot key={period} chart={chart} period={period} money={money} />
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              {chart.xLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.empty}>
            {history === null
              ? 'Загружаем историю…'
              : history.length === 1
                ? `Пока одна точка: ${shortDate(history[0]!.day)}. Binder записывает цену каждый день, когда карту открывает кто-то из клуба, — график появится через несколько дней.`
                : 'Истории пока нет: Binder начал записывать цены 20 ноября 2026 и копит их, когда карты открывают в клубе.'}{' '}
            {market && marketNote(market)}
          </p>
        )}
        <p className={styles.source}>
          {fromMarket
            ? 'История за год — TCGplayer через JustTCG, без грейда, Near Mint.'
            : view.lang === 'ja'
              ? 'Доллары — TCGplayer через JustTCG, евро — Cardmarket через TCGdex.'
              : 'TCGplayer и Cardmarket через TCGdex.'}{' '}
          Обновляются раз в сутки.
          {fromMarket && view.lang !== 'en' && view.catalog === 'en' ? ' Цены английской карты.' : ''}
        </p>
      </section>

      <GradedPanel view={view} market={market} />
    </>
  );
}

type Money = (value: number, kind: 'usd' | 'eur') => string;

/**
 * Поле графика. Наведение мышью или пальцем показывает вертикальную линию, точку и подсказку
 * с датой и ценой ближайшего дня. С клавиатуры это ползунок по дням: стрелки, Home и End.
 */
function ChartPlot({ chart, period, money }: { chart: Chart; period: ChartPeriod; money: Money }) {
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
      className={styles.plot}
      role="slider"
      tabIndex={0}
      aria-label={`История цены за ${period}`}
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
      <svg aria-hidden="true" width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="none">
        {[40, 100, 160].map((y) => (
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

/** Рынок карты из JustTCG: null — ещё загружается. */
function useCardMarket(view: CardView): MarketResult | null {
  const [market, setMarket] = useState<MarketResult | null>(null);

  useEffect(() => {
    let active = true;
    setMarket(null);
    void loadCardMarket(binderDb(), view)
      .catch((): MarketResult => ({ market: null, day: null, problem: 'offline', until: null }))
      .then((result) => active && setMarket(result));
    return () => {
      active = false;
    };
    // У японских карт ID в JustTCG появляется вместе с их ценой: тогда пробуем ещё раз
  }, [view.docId, view.price?.u]);

  return market;
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Почему из JustTCG нет свежих данных; пустая строка — объяснять нечего. */
function marketNote(result: MarketResult): string {
  switch (result.problem) {
    case 'no-key':
      return 'История за год и цены в грейде появятся, когда админ добавит ключ JustTCG.';
    case 'invalid-key':
      return 'Ключи JustTCG клуба не подошли: админ может проверить их на своей странице.';
    case 'limit':
      return result.until
        ? `Запросы JustTCG на сегодня кончились на всех ключах клуба, снова с ${timeFormat.format(result.until)}.`
        : 'Запросы JustTCG на сегодня кончились на всех ключах клуба.';
    case 'offline':
      return 'JustTCG сейчас не ответил, попробуем при следующем открытии.';
    default:
      return '';
  }
}

const GRADED_LIMIT = 8;

/** Цены в грейде: по продажам слабов за 90 дней из JustTCG. */
function GradedPanel({ view, market }: { view: CardView; market: MarketResult | null }) {
  const titleId = useId();
  const [all, setAll] = useState(false);
  if (market?.problem === 'unsupported') return null;

  const graded = market?.market?.graded ?? [];
  const shown = all ? graded : graded.slice(0, GRADED_LIMIT);
  const stale = market?.day && market.day !== utcDay() ? shortDate(market.day) : null;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.panelHead}>
        <div>
          <h2 id={titleId} className={styles.panelTitle}>
            Цены в грейде
          </h2>
          <span className={styles.muted}>по продажам за последние 90 дней</span>
        </div>
      </div>
      {market === null ? (
        <p className={styles.empty}>Смотрим цены в грейде…</p>
      ) : market.problem === 'not-found' ? (
        <p className={styles.empty}>Этой карты нет в JustTCG, цен в грейде для неё нет.</p>
      ) : !market.market ? (
        <p className={styles.empty}>{marketNote(market) || 'Цен в грейде пока нет.'}</p>
      ) : graded.length === 0 ? (
        <p className={styles.empty}>Продаж этой карты в грейде за последние 90 дней не было.</p>
      ) : (
        <>
          <div className={styles.prices}>
            {shown.map((slab) => (
              <div key={slab.label} className={styles.priceCell}>
                <span className={styles.priceLabel}>{slab.label}</span>
                <span className={styles.priceValue}>{formatCardPrice({ u: slab.price, e: null })}</span>
                <span className={cx(styles.priceChange, styles.neutral)}>{slabNote(slab)}</span>
              </div>
            ))}
          </div>
          {graded.length > GRADED_LIMIT && (
            <button type="button" className={styles.textButton} onClick={() => setAll((value) => !value)}>
              {all ? 'Свернуть' : `Показать все: ${graded.length}`}
            </button>
          )}
        </>
      )}
      <p className={styles.source}>
        TCGplayer и магазины-партнёры через JustTCG, в долларах. Цена слаба — по его настоящим продажам, без пересчёта из цены без
        грейда.
        {stale ? ` Данные за ${stale}: ${marketNote(market!) || 'свежих пока нет.'}` : ''}
        {view.lang !== 'en' && view.catalog === 'en' ? ' Цены английской карты.' : ''}
      </p>
    </section>
  );
}

const SALE_FORMS: [string, string, string] = ['продажа', 'продажи', 'продаж'];

function slabNote(slab: GradedPrice): string {
  const date = slab.lastSale ? shortDate(new Date(slab.lastSale).toISOString().slice(0, 10)) : null;
  if (!slab.current) return date ? `последняя продажа ${date}, давно` : 'продаж давно не было';
  const sales = slab.sales90 && slab.sales90 > 1 ? countLabel(slab.sales90, SALE_FORMS) : null;
  return [date ? `продажа ${date}` : null, sales].filter(Boolean).join(', ') || 'по продажам';
}

function costLabel(cost: Energy[]): string {
  return cost.length > 0 ? cost.map((item) => item.label).join(', ') : 'без энергии';
}

function FactsPanel({ view, text }: { view: CardView; text: ReturnType<typeof useCardText> }) {
  const { facts } = text;
  const titleId = useId();
  const rows: Array<[string, ReactNode]> = [];
  if (facts) {
    const kind = facts.category === 'pokemon' ? 'Покемон' : facts.category === 'trainer' ? 'Тренер' : facts.category === 'energy' ? 'Энергия' : null;
    if (kind) rows.push(['Категория', [kind, facts.trainerType].filter(Boolean).join(', ')]);
    if (facts.hp) rows.push(['HP', facts.hp]);
    if (facts.stage) rows.push(['Стадия', facts.evolveFrom ? `${facts.stage}, эволюция из «${facts.evolveFrom}»` : facts.stage]);
    if (facts.weaknesses.length > 0) {
      rows.push([
        'Слабость',
        <span className={styles.energies}>
          {facts.weaknesses.map((item) => (
            <span key={item.type.type}>
              <EnergyDot energy={item.type} /> {item.type.label} {item.value ?? ''}
            </span>
          ))}
        </span>,
      ]);
    }
    if (facts.resistances.length > 0) {
      rows.push([
        'Сопротивление',
        <span className={styles.energies}>
          {facts.resistances.map((item) => (
            <span key={item.type.type}>
              <EnergyDot energy={item.type} /> {item.type.label} {item.value ?? ''}
            </span>
          ))}
        </span>,
      ]);
    }
    if (facts.retreat !== null && facts.category === 'pokemon') rows.push(['Отступление', facts.retreat === 0 ? 'бесплатно' : `${facts.retreat} × Бесцветная`]);
    if (facts.regulationMark) rows.push(['Регуляция', facts.regulationMark]);
    if (facts.variants) {
      const variants = [
        facts.variants.normal && 'обычная',
        facts.variants.holo && 'голо',
        facts.variants.reverse && 'реверс',
        facts.variants.firstEdition && '1-е издание',
      ].filter(Boolean);
      if (variants.length > 0) rows.push(['Бывает', variants.join(', ')]);
    }
    if (facts.legal) {
      rows.push(['Турниры', `стандарт: ${facts.legal.standard ? 'да' : 'нет'}, расширенный: ${facts.legal.expanded ? 'да' : 'нет'}`]);
    }
  }
  const set = [view.setName, text.serie, view.releaseDate ? releaseFormat.format(new Date(view.releaseDate)) : null].filter(Boolean).join(', ');
  rows.push(['Сет', set || '—']);
  rows.push(['Номер', numberLabel(view)]);
  rows.push(['Язык', LANGUAGE_LABELS[view.lang].card]);

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.panelHead}>
        <h2 id={titleId} className={styles.panelTitle}>
          О карте
        </h2>
        {text.translation && text.original && (
          <div role="group" aria-label="Язык текста" className={cx(styles.segmented, styles.periods)}>
            <button type="button" aria-pressed={text.mode === 'translation'} onClick={() => text.setMode('translation')}>
              Перевод
            </button>
            <button type="button" aria-pressed={text.mode === 'original'} onClick={() => text.setMode('original')}>
              Оригинал
            </button>
          </div>
        )}
      </div>

      {text.loading && !facts && <p className={styles.empty}>Загружаем текст карты…</p>}
      {!text.loading && !facts && <p className={styles.empty}>Текста этой карты нет ни в TCGdex, ни в Limitless TCG.</p>}

      {facts && (facts.abilities.length > 0 || facts.attacks.length > 0 || facts.effect) && (
        <div className={styles.moves}>
          {facts.abilities.map((ability) => (
            <div key={ability.name} className={styles.move}>
              <div className={styles.moveHead}>
                <span className={styles.moveKind}>{ability.kind === 'Ability' ? 'Способность' : ability.kind}</span>
                <span className={styles.moveName}>{ability.name}</span>
              </div>
              {ability.effect && <p className={styles.moveText}>{ability.effect}</p>}
            </div>
          ))}
          {facts.attacks.map((attack) => (
            <div key={attack.name} className={styles.move}>
              <div className={styles.moveHead}>
                <span className={styles.cost} role="img" aria-label={`Стоимость: ${costLabel(attack.cost)}`}>
                  {attack.cost.map((item, index) => (
                    <EnergyDot key={index} energy={item} />
                  ))}
                </span>
                <span className={styles.moveName}>{attack.name}</span>
                {attack.damage && <span className={styles.damage}>{attack.damage}</span>}
              </div>
              {attack.effect && <p className={styles.moveText}>{attack.effect}</p>}
            </div>
          ))}
          {facts.effect && <p className={styles.moveText}>{facts.effect}</p>}
        </div>
      )}

      <dl className={styles.facts}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {facts?.description && <p className={styles.flavor}>{facts.description}</p>}
      {text.mode === 'translation' && text.translation && (
        <p className={styles.source}>Текст атак и способностей — английский перевод Limitless TCG.</p>
      )}
    </section>
  );
}

function FriendsPanel({ uid, docId }: { uid: string; docId: string }) {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const titleId = useId();

  useEffect(() => {
    let active = true;
    void friendsWithCard(binderDb(), uid, docId)
      .catch(() => [])
      .then((list) => active && setOwners(list));
    return () => {
      active = false;
    };
  }, [uid, docId]);

  return (
    <section className={cx(styles.panel, styles.friends)} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.panelTitle}>
        Есть у друзей
      </h2>
      {owners === null ? (
        <p className={styles.muted}>Смотрим альбомы клуба…</p>
      ) : owners.length === 0 ? (
        <p className={styles.muted}>Ни у кого из клуба такой карты пока нет.</p>
      ) : (
        <div className={styles.chips}>
          {owners.map((owner) => (
            <Link key={owner.uid} href={`/u/${owner.uid}`} className={styles.chip}>
              <Avatar src={owner.photoURL} name={owner.name} size={32} />
              <span className={styles.chipName}>{owner.name}</span>
              <span className={styles.muted}>{countLabel(owner.count, ['шт.', 'шт.', 'шт.'])}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
