import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  INERTIA_MAX_SPEED,
  INERTIA_MIN_SPEED,
  applyDrag,
  axisAngle,
  faceNormal,
  flipTarget,
  glarePosition,
  releaseSpin,
  rotate,
  slerp,
  stepSpin,
  toMatrix3d,
  visibleFace,
  wheelZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  type Quat,
  type Sample,
} from '@/lib/card-spin';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const Y = { x: 0, y: 1, z: 0 };

/** Матрица из строки matrix3d(…) — 16 чисел по столбцам */
const matrix = (q: Quat) => toMatrix3d(q).slice('matrix3d('.length, -1).split(',').map(Number);

describe('поворот', () => {
  it('rotateY в CSS: правый край уходит от зрителя', () => {
    const v = rotate(axisAngle(Y, 90), { x: 1, y: 0, z: 0 });
    close(v.x, 0);
    close(v.z, -1);
  });

  it('matrix3d совпадает с rotateY(90deg) из спецификации CSS', () => {
    // rotateY(a) = matrix3d(cos,0,-sin,0, 0,1,0,0, sin,0,cos,0, 0,0,0,1)
    expect(matrix(axisAngle(Y, 90))).toEqual([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('matrix3d совпадает с rotateX(90deg)', () => {
    // rotateX(a) = matrix3d(1,0,0,0, 0,cos,sin,0, 0,-sin,cos,0, 0,0,0,1)
    expect(matrix(axisAngle({ x: 1, y: 0, z: 0 }, 90))).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
  });

  it('без поворота — единичная матрица, лицо к зрителю', () => {
    expect(matrix(IDENTITY)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(visibleFace(IDENTITY)).toBe('front');
  });
});

describe('перетаскивание', () => {
  it('вправо — лицо поворачивается вправо', () => {
    const n = faceNormal(applyDrag(IDENTITY, 40, 0));
    expect(n.x).toBeGreaterThan(0);
    close(n.y, 0);
  });

  it('вниз — верх карты наклоняется к зрителю, лицо смотрит вниз', () => {
    const q = applyDrag(IDENTITY, 0, 40);
    expect(faceNormal(q).y).toBeGreaterThan(0);
    expect(rotate(q, { x: 0, y: -1, z: 0 }).z).toBeGreaterThan(0);
  });

  it('пол-оборота перетаскиванием открывает рубашку', () => {
    expect(visibleFace(applyDrag(IDENTITY, 180 / 0.45, 0))).toBe('back');
  });

  it('у перевёрнутой вверх ногами карты перетаскивание вправо тоже ведёт лицо вправо', () => {
    const upsideDown = axisAngle({ x: 1, y: 0, z: 0 }, 180);
    const tilted = applyDrag(axisAngle({ x: 0, y: 0, z: 1 }, 180), 20, 0);
    // Лицо карты, повёрнутой в плоскости экрана, после рывка вправо всё равно смотрит вправо
    expect(faceNormal(tilted).x).toBeGreaterThan(0);
    // А у карты рубашкой к зрителю рывок вправо уводит рубашку вправо: нормаль лица — влево
    expect(faceNormal(applyDrag(upsideDown, 20, 0)).x).toBeLessThan(0);
  });

  it('кватернион остаётся единичным после тысячи рывков', () => {
    let q = IDENTITY;
    for (let i = 0; i < 1000; i++) q = applyDrag(q, 7 * Math.sin(i), 5 * Math.cos(i * 0.7));
    close(Math.hypot(q.x, q.y, q.z, q.w), 1, 9);
  });
});

describe('переворот', () => {
  it('с лица — на рубашку ровно, с рубашки — на лицо ровно', () => {
    const tilted = applyDrag(IDENTITY, 30, -20);
    const back = flipTarget(tilted);
    expect(visibleFace(back)).toBe('back');
    close(faceNormal(back).z, -1);
    expect(flipTarget(back)).toEqual(IDENTITY);
  });

  it('slerp: на концах — исходный и целевой поворот, в середине — четверть оборота', () => {
    const target = axisAngle(Y, 180);
    expect(slerp(IDENTITY, target, 0)).toEqual(IDENTITY);
    const end = slerp(IDENTITY, target, 1);
    close(Math.abs(end.y), 1);
    const half = faceNormal(slerp(IDENTITY, target, 0.5));
    close(Math.abs(half.z), 0);
  });
});

describe('инерция', () => {
  const samples = (count: number, dx: number, dtMs: number, start = 0): Sample[] =>
    Array.from({ length: count }, (_, i) => ({ t: start + i * dtMs, dx, dy: 0 }));

  it('быстрый рывок даёт скорость по направлению рывка', () => {
    const list = samples(6, 12, 16);
    const spin = releaseSpin(list, list.at(-1)!.t);
    expect(spin).not.toBeNull();
    expect(spin!.axis.y).toBeGreaterThan(0);
    expect(spin!.speed).toBeGreaterThan(INERTIA_MIN_SPEED);
  });

  it('если перед отпусканием палец стоял, карта не едет', () => {
    const list = samples(6, 12, 16);
    expect(releaseSpin(list, list.at(-1)!.t + 300)).toBeNull();
  });

  it('скорость ограничена сверху', () => {
    const list = samples(5, 900, 16);
    expect(releaseSpin(list, list.at(-1)!.t)!.speed).toBe(INERTIA_MAX_SPEED);
  });

  it('скорость затухает и карта останавливается', () => {
    let q = IDENTITY;
    let spin = { axis: Y, speed: 1 };
    let frames = 0;
    for (; frames < 1000; frames++) {
      const next = stepSpin(q, spin, 16);
      q = next.q;
      if (!next.spin) break;
      expect(next.spin.speed).toBeLessThan(spin.speed);
      spin = next.spin;
    }
    expect(frames).toBeLessThan(400);
    expect(faceNormal(q).x).not.toBe(0);
  });
});

describe('блик и приближение', () => {
  it('в покое блик слева сверху, при повороте вправо уходит влево', () => {
    const rest = glarePosition(IDENTITY, 'front');
    expect(rest).toEqual({ x: 35, y: 25 });
    expect(glarePosition(applyDrag(IDENTITY, 40, 0), 'front').x).toBeLessThan(rest.x);
  });

  it('у рубашки к зрителю блик там же, где у лица в покое', () => {
    const p = glarePosition(axisAngle(Y, 180), 'back');
    close(p.x, 35);
    close(p.y, 25);
  });

  it('колесо приближает и отдаляет в пределах', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(1, -100000)).toBe(ZOOM_MAX);
    expect(wheelZoom(1, 100000)).toBe(ZOOM_MIN);
  });
});
