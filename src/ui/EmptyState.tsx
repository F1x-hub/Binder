import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

/** Картинка экрана «страница»: альбом, колоды, друзья или ошибка загрузки */
export type EmptyArt = 'album' | 'decks' | 'friends' | 'error';

type Props = {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /**
   * panel — панель в потоке страницы (по умолчанию, как раньше);
   * page — весь экран раздела: по центру, картинка, заголовок, пояснение и одна главная кнопка.
   */
  variant?: 'panel' | 'page';
  /** Картинка варианта page; по умолчанию album, у ошибки — error */
  art?: EmptyArt;
  /** error — экран ошибки: скринридер объявляет его сразу (role="alert") */
  tone?: 'empty' | 'error';
};

/** Экран или панель для разделов, где данных пока нет (или они не загрузились). */
export function EmptyState({ title, children, action, variant = 'panel', art, tone = 'empty' }: Props) {
  const role = tone === 'error' ? 'alert' : undefined;

  if (variant === 'page') {
    return (
      <section className={styles.page} role={role}>
        <div className={styles.art} aria-hidden="true">
          <Art kind={art ?? (tone === 'error' ? 'error' : 'album')} />
        </div>
        <h2 className={styles.pageTitle}>{title}</h2>
        {children && <p className={styles.pageText}>{children}</p>}
        {action && <div className={styles.pageAction}>{action}</div>}
      </section>
    );
  }

  return (
    <section className={styles.panel} role={role}>
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}

/*
 * Картинки из простых фигур, цвета и скругления — токены темы (классы в EmptyState.module.css).
 * Карты здесь — рамка с окошком, без персонажей и без оформления официальных карт.
 */

/** Значок-подсказка в углу картинки: «+» или «!» цветом выбора темы */
function Badge({ x, y, mark }: { x: number; y: number; mark: 'plus' | 'alert' }) {
  return (
    <g>
      <circle className={styles.badge} cx={x} cy={y} r={11} />
      {mark === 'plus' ? (
        <path className={styles.badgeMark} d={`M${x - 4.5} ${y}h9M${x} ${y - 4.5}v9`} />
      ) : (
        <>
          <path className={styles.badgeMark} d={`M${x} ${y - 5.5}v6`} />
          <circle className={styles.badgeDot} cx={x} cy={y + 4.5} r={1.4} />
        </>
      )}
    </g>
  );
}

/** Карта: рамка, окошко под картинку и две строки текста */
function CardShape({ x, y, w, h, back = false }: { x: number; y: number; w: number; h: number; back?: boolean }) {
  const pad = w * 0.1;
  return (
    <g>
      <rect className={back ? styles.cardBack : styles.card} x={x} y={y} width={w} height={h} />
      {!back && (
        <>
          <rect className={styles.cardWindow} x={x + pad} y={y + pad} width={w - pad * 2} height={h * 0.46} />
          <path className={styles.cardLine} d={`M${x + pad} ${y + h * 0.7}h${w * 0.56}M${x + pad} ${y + h * 0.81}h${w * 0.36}`} />
        </>
      )}
    </g>
  );
}

/** Страница биндера 86 × 120 с карманами 3 × 3 */
function Sheet({ x, y }: { x: number; y: number }) {
  const pockets = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));
  return (
    <g>
      <rect className={styles.sheet} x={x} y={y} width={86} height={120} />
      {pockets.map(({ row, col }) => (
        <rect key={`${row}-${col}`} className={styles.pocket} x={x + 7 + col * 25} y={y + 7 + row * 37.5} width={22} height={31} />
      ))}
    </g>
  );
}

function Art({ kind }: { kind: EmptyArt }) {
  return (
    <svg className={styles.svg} viewBox="0 0 200 136" fill="none">
      {kind === 'album' && (
        <>
          <Sheet x={8} y={8} />
          <Sheet x={106} y={8} />
          {[34, 68, 102].map((cy) => (
            <circle key={cy} className={styles.ring} cx={100} cy={cy} r={4} />
          ))}
          <g transform="rotate(-8 149 70)">
            <CardShape x={129} y={42} w={40} h={56} />
          </g>
          <Badge x={170} y={40} mark="plus" />
        </>
      )}
      {kind === 'decks' && (
        <>
          <g transform="rotate(-14 100 128)">
            <CardShape x={72} y={30} w={56} h={78} back />
          </g>
          <g transform="rotate(14 100 128)">
            <CardShape x={72} y={30} w={56} h={78} back />
          </g>
          <CardShape x={72} y={26} w={56} h={78} />
          <Badge x={128} y={26} mark="plus" />
        </>
      )}
      {kind === 'friends' && (
        <>
          {[76, 124].map((cx) => (
            <g key={cx}>
              <circle className={styles.avatar} cx={cx} cy={70} r={32} />
              <circle className={styles.head} cx={cx} cy={60} r={10} />
              <path className={styles.head} d={`M${cx - 17} ${92}a17 15 0 0 1 34 0z`} />
            </g>
          ))}
          <Badge x={150} y={44} mark="plus" />
        </>
      )}
      {kind === 'error' && (
        <>
          <Sheet x={57} y={8} />
          <Badge x={139} y={16} mark="alert" />
        </>
      )}
    </svg>
  );
}
