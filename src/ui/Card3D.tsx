import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  IDENTITY,
  applyDrag,
  clampZoom,
  easeInOut,
  flipTarget,
  glarePosition,
  releaseSpin,
  slerp,
  stepSpin,
  toMatrix3d,
  turnOnScreen,
  visibleFace,
  wheelZoom,
  type Quat,
  type Sample,
  type Spin,
} from '@/lib/card-spin';
import type { LimitlessRef } from '@/lib/limitless';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import styles from './Card3D.module.css';

/** Общая рубашка современных карт Pokémon TCG, лежит в расширении (public/card-back.webp) */
export const CARD_BACK = '/card-back.webp';

/** Слои торца по толщине карты: от −0.5 (у рубашки) до 0.5 (у лица), без самих граней. */
const EDGE_LAYERS = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42];

type Props = {
  image?: string;
  limitless?: LimitlessRef | null;
  thumb?: string | null;
  name: string;
  number?: string;
  /** Голо и реверс переливаются радугой */
  holo?: boolean;
  className?: string;
};

/** Поворот в покое: лёгкий наклон, чтобы с первого взгляда было видно, что карта объёмная */
const REST: Quat = turnOnScreen(turnOnScreen(IDENTITY, { x: 0, y: 1, z: 0 }, -14), { x: 1, y: 0, z: 0 }, 6);
const FLIP_MS = 560;
const KEY_MS = 160;
const KEY_STEP = 15;
/** Нажатие без сдвига дальше этого (px) — это нажатие, а не перетаскивание */
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 320;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Карта в 3D: лицо — скан (тот же порядок источников, что у CardImage), рубашка — общая рубашка
 * Pokémon TCG, между ними тонкий торец, чтобы ребром карта не исчезала. Рисуется на CSS 3D:
 * две грани с backface-visibility: hidden в preserve-3d. Поворот — кватернион в
 * src/lib/card-spin.ts, на кадр меняется только transform карты и переменные блика,
 * React при вращении не перерисовывается.
 *
 * Перетаскивание (мышь, палец, перо) крутит карту по обеим осям, после отпускания — инерция.
 * Двойное нажатие, пробел или «Перевернуть» — на другую сторону; колесо и щипок — приближение;
 * стрелки — поворот на 15° (с Shift — на 45°), 0 — ровно, + и − — приближение. При «уменьшить
 * движение» нет инерции и анимаций переворота. В теме Ретро нет блика и перелива.
 */
export function Card3D({ image, limitless, thumb, name, number, holo = false, className }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const zoomBox = useRef<HTMLDivElement>(null);
  const rotation = useRef<Quat>(REST);
  const zoom = useRef(1);
  const frame = useRef(0);
  /** Куда идёт плавный переход: следующая стрелка поворачивает от цели, а не от середины пути */
  const heading = useRef<Quat | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; moved: number; samples: Sample[] } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [dragging, setDragging] = useState(false);

  const paint = useCallback(() => {
    const q = rotation.current;
    const el = card.current;
    if (!el) return;
    const shown = visibleFace(q);
    const glare = glarePosition(q, shown);
    el.style.transform = toMatrix3d(q);
    el.style.setProperty('--mx', `${glare.x.toFixed(1)}%`);
    el.style.setProperty('--my', `${glare.y.toFixed(1)}%`);
    if (zoomBox.current) zoomBox.current.style.transform = `scale(${zoom.current.toFixed(3)})`;
    setFace((previous) => (previous === shown ? previous : shown));
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    heading.current = null;
  }, []);

  useEffect(() => {
    paint();
    return stop;
  }, [paint, stop]);

  /** Плавный переход к повороту; при «уменьшить движение» — сразу */
  const animateTo = useCallback(
    (target: Quat, ms: number) => {
      stop();
      if (reducedMotion() || ms <= 0) {
        rotation.current = target;
        paint();
        return;
      }
      const from = rotation.current;
      heading.current = target;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        rotation.current = t === 1 ? target : slerp(from, target, easeInOut(t));
        paint();
        frame.current = t === 1 ? 0 : requestAnimationFrame(tick);
        if (t === 1) heading.current = null;
      };
      frame.current = requestAnimationFrame(tick);
    },
    [paint, stop],
  );

  const coast = useCallback(
    (spin: Spin) => {
      stop();
      let current: Spin | null = spin;
      let last = performance.now();
      const tick = (now: number) => {
        if (!current) return;
        const step = stepSpin(rotation.current, current, Math.min(48, now - last));
        last = now;
        rotation.current = step.q;
        current = step.spin;
        paint();
        frame.current = current ? requestAnimationFrame(tick) : 0;
      };
      frame.current = requestAnimationFrame(tick);
    },
    [paint, stop],
  );

  const flip = useCallback(() => animateTo(flipTarget(rotation.current), FLIP_MS), [animateTo]);
  const reset = useCallback(() => {
    zoom.current = 1;
    animateTo(REST, FLIP_MS);
  }, [animateTo]);

  const setZoom = useCallback(
    (value: number) => {
      zoom.current = clampZoom(value);
      paint();
    },
    [paint],
  );

  // Колесо приближает. Слушатель не пассивный: иначе нельзя отменить прокрутку окна.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(wheelZoom(zoom.current, event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setZoom]);

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stop();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен: тянуть всё равно можно, пока он над сценой
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      // Второй палец: щипок приближает, вращение на это время останавливается
      drag.current = null;
      pinch.current = { distance: pinchDistance(), zoom: zoom.current };
      return;
    }
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, samples: [{ t: event.timeStamp, dx: 0, dy: 0 }] };
    setDragging(true);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current) {
      const distance = pinchDistance();
      if (pinch.current.distance > 0 && distance > 0) setZoom((pinch.current.zoom * distance) / pinch.current.distance);
      return;
    }
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (dx === 0 && dy === 0) return;
    state.x = event.clientX;
    state.y = event.clientY;
    state.moved += Math.hypot(dx, dy);
    state.samples.push({ t: event.timeStamp, dx, dy });
    if (state.samples.length > 12) state.samples.shift();
    rotation.current = applyDrag(rotation.current, dx, dy);
    paint();
  };

  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) setDragging(false);
      return;
    }
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (!state || state.id !== event.pointerId) return;
    if (state.moved < TAP_SLOP && event.type === 'pointerup') {
      const tap = lastTap.current;
      if (tap && event.timeStamp - tap.t < DOUBLE_TAP_MS && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 32) {
        lastTap.current = null;
        flip();
      } else {
        lastTap.current = { t: event.timeStamp, x: event.clientX, y: event.clientY };
      }
      return;
    }
    if (reducedMotion() || event.type !== 'pointerup') return;
    const spin = releaseSpin(state.samples, event.timeStamp);
    if (spin) coast(spin);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 45 : KEY_STEP;
    const turns: Record<string, [{ x: number; y: number; z: number }, number]> = {
      ArrowLeft: [{ x: 0, y: 1, z: 0 }, -step],
      ArrowRight: [{ x: 0, y: 1, z: 0 }, step],
      ArrowUp: [{ x: 1, y: 0, z: 0 }, step],
      ArrowDown: [{ x: 1, y: 0, z: 0 }, -step],
    };
    const turn = turns[event.key];
    if (turn) {
      animateTo(turnOnScreen(heading.current ?? rotation.current, turn[0], turn[1]), KEY_MS);
    } else if (event.key === ' ' || event.key === 'Enter') {
      flip();
    } else if (event.key === '0' || event.key === 'Home') {
      reset();
    } else if (event.key === '+' || event.key === '=') {
      setZoom(zoom.current * 1.15);
    } else if (event.key === '-' || event.key === '_') {
      setZoom(zoom.current / 1.15);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div className={cx(styles.root, className)}>
      <div
        ref={stage}
        className={cx(styles.stage, dragging && styles.dragging)}
        tabIndex={0}
        role="group"
        aria-roledescription="3D-карта"
        aria-label={`${name}${number ? `, ${number}` : ''}. Стрелки крутят карту, пробел переворачивает, плюс и минус приближают`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onKeyDown={key}
      >
        <div ref={zoomBox} className={styles.zoom}>
          <div ref={card} className={styles.card}>
            <div className={cx(styles.face, styles.front)}>
              <CardImage image={image} limitless={limitless} thumb={thumb} name={name} number={number} quality="high" className={styles.image} />
              <span className={cx(styles.sheen, holo && styles.holo)} aria-hidden="true" />
            </div>
            <div className={cx(styles.face, styles.back)} aria-hidden="true">
              <img src={CARD_BACK} alt="" className={styles.backImage} draggable={false} />
              <span className={styles.sheen} />
            </div>
            {/* Торец — стопка тонких слоёв той же формы, что и грани: сбоку они сливаются в сплошное ребро вместе со скруглёнными углами */}
            {EDGE_LAYERS.map((depth) => (
              <span
                key={depth}
                className={cx(styles.layer, Math.abs(depth) < 0.3 && styles.core)}
                style={{ '--d': depth } as CSSProperties}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.control} onClick={flip}>
          {face === 'front' ? 'Показать рубашку' : 'Показать лицо'}
        </button>
        <button type="button" className={styles.control} onClick={reset}>
          Поставить ровно
        </button>
      </div>
      <p className={styles.hint}>Тяни карту, чтобы покрутить. Двойное нажатие — перевернуть, колесо или щипок — приблизить.</p>
      <p className={styles.status} aria-live="polite">
        {face === 'front' ? 'Видно лицо карты' : 'Видна рубашка карты'}
      </p>
    </div>
  );
}
