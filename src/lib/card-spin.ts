/**
 * Вращение карты в 3D без интерфейса: поворот хранится кватернионом, перетаскивание крутит
 * карту вокруг осей экрана (как трекбол), поэтому карту, повёрнутую вверх ногами, тянут
 * так же, как стоящую ровно. Оси — как в CSS: x вправо, y вниз, z к зрителю.
 */

export type Quat = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Градусов поворота на пиксель перетаскивания */
export const DRAG_DEG_PER_PX = 0.45;
/** Затухание инерции: за столько миллисекунд скорость падает в e раз */
export const INERTIA_TAU_MS = 420;
/** Медленнее этого (градусов в миллисекунду) инерция останавливается */
export const INERTIA_MIN_SPEED = 0.004;
/** Быстрее этого карту после отпускания не раскрутить */
export const INERTIA_MAX_SPEED = 2.2;
/** Скорость считается по движениям за последние столько миллисекунд */
export const VELOCITY_WINDOW_MS = 90;

const RAD = Math.PI / 180;

export function axisAngle(axis: Vec3, deg: number): Quat {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0 || deg === 0) return IDENTITY;
  const half = (deg * RAD) / 2;
  const s = Math.sin(half) / length;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

/** Сначала поворот b, потом a */
export function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function normalize(q: Quat): Quat {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return length === 0 ? IDENTITY : { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2u × (u × v), u — векторная часть
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  return {
    x: v.x + 2 * (q.w * cx + q.y * cz - q.z * cy),
    y: v.y + 2 * (q.w * cy + q.z * cx - q.x * cz),
    z: v.z + 2 * (q.w * cz + q.x * cy - q.y * cx),
  };
}

/** Поворот вокруг осей экрана, уже сделанный поверх текущего */
export function turnOnScreen(q: Quat, axis: Vec3, deg: number): Quat {
  return normalize(multiply(axisAngle(axis, deg), q));
}

/**
 * Ось и угол поворота от перетаскивания на (dx, dy) пикселей: вправо — лицо уходит вправо
 * (вокруг оси y), вниз — верх карты наклоняется к зрителю (вокруг оси x).
 */
export function dragRotation(dx: number, dy: number, degPerPx = DRAG_DEG_PER_PX): { axis: Vec3; deg: number } {
  return { axis: { x: -dy, y: dx, z: 0 }, deg: Math.hypot(dx, dy) * degPerPx };
}

export function applyDrag(q: Quat, dx: number, dy: number, degPerPx = DRAG_DEG_PER_PX): Quat {
  const { axis, deg } = dragRotation(dx, dy, degPerPx);
  return turnOnScreen(q, axis, deg);
}

/** Где карта смотрит лицом: нормаль лица в осях экрана. z > 0 — лицо к зрителю. */
export function faceNormal(q: Quat): Vec3 {
  return rotate(q, { x: 0, y: 0, z: 1 });
}

export function visibleFace(q: Quat): 'front' | 'back' {
  return faceNormal(q).z >= 0 ? 'front' : 'back';
}

/** CSS matrix3d для поворота (столбцы подряд, как требует CSS) */
export function toMatrix3d(q: Quat): string {
  const { x, y, z, w } = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  return `matrix3d(${m.map((value) => (Math.abs(value) < 1e-9 ? 0 : +value.toFixed(6))).join(',')})`;
}

/** Плавный переход между поворотами по кратчайшей дуге */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let target = b;
  if (dot < 0) {
    dot = -dot;
    target = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (dot > 0.9995) {
    return normalize({
      x: a.x + (target.x - a.x) * t,
      y: a.y + (target.y - a.y) * t,
      z: a.z + (target.z - a.z) * t,
      w: a.w + (target.w - a.w) * t,
    });
  }
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const k0 = Math.sin((1 - t) * theta) / sin;
  const k1 = Math.sin(t * theta) / sin;
  return {
    x: a.x * k0 + target.x * k1,
    y: a.y * k0 + target.y * k1,
    z: a.z * k0 + target.z * k1,
    w: a.w * k0 + target.w * k1,
  };
}

/**
 * Переворот на другую сторону: пол-оборота вокруг вертикали экрана. Перед этим наклон
 * сбрасывается, чтобы после переворота карта стояла ровно, лицом или рубашкой к зрителю.
 */
export function flipTarget(q: Quat): Quat {
  return visibleFace(q) === 'front' ? axisAngle({ x: 0, y: 1, z: 0 }, 180) : IDENTITY;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Скорость вращения: ось в осях экрана и градусы в миллисекунду */
export type Spin = { axis: Vec3; speed: number };

export type Sample = { t: number; dx: number; dy: number };

/**
 * Скорость после отпускания — по движениям за последние VELOCITY_WINDOW_MS. Если палец
 * перед отпусканием стоял, скорости нет: карта не должна сама поехать.
 */
export function releaseSpin(samples: readonly Sample[], now: number, degPerPx = DRAG_DEG_PER_PX): Spin | null {
  const recent = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS);
  const first = recent[0];
  if (!first || recent.length < 2) return null;
  const span = Math.max(16, now - first.t);
  let dx = 0;
  let dy = 0;
  for (const sample of recent.slice(1)) {
    dx += sample.dx;
    dy += sample.dy;
  }
  const { axis, deg } = dragRotation(dx, dy, degPerPx);
  const speed = Math.min(INERTIA_MAX_SPEED, deg / span);
  return speed < INERTIA_MIN_SPEED ? null : { axis, speed };
}

/** Шаг инерции: поворот за dt и затухшая скорость; null — карта остановилась */
export function stepSpin(q: Quat, spin: Spin, dtMs: number): { q: Quat; spin: Spin | null } {
  const next = turnOnScreen(q, spin.axis, spin.speed * dtMs);
  const speed = spin.speed * Math.exp(-dtMs / INERTIA_TAU_MS);
  return { q: next, spin: speed < INERTIA_MIN_SPEED ? null : { axis: spin.axis, speed } };
}

/** Где блик на грани: свет спереди сверху слева, пятно сдвигается вслед за наклоном. В процентах. */
export function glarePosition(q: Quat, face: 'front' | 'back'): { x: number; y: number } {
  const n = faceNormal(q);
  // Нормаль рубашки смотрит в обратную сторону. Когда рубашка повёрнута к зрителю, её
  // собственные оси совпадают с осями экрана, поэтому формула для обеих граней одна.
  const sign = face === 'front' ? 1 : -1;
  const clamp = (value: number) => Math.min(110, Math.max(-10, value));
  return { x: clamp(35 - sign * n.x * 90), y: clamp(25 - sign * n.y * 90) };
}

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.8;

export function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Колесо: шаг вниз отдаляет, вверх приближает, плавно при любом размере шага */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * 0.0015));
}
