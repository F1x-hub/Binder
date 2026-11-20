import { Link, useLocation } from 'wouter';
import { Brand } from '@/ui/Brand';
import { cx } from '@/ui/cx';
import { SearchIcon, UserIcon } from '@/ui/Icons';
import styles from './PageHeader.module.css';

/** Разделы вкладки и маршруты, при которых раздел подсвечен. */
const SECTIONS = [
  { path: '/library', label: 'Альбом', match: ['/library', '/card/', '/scan'] },
  { path: '/decks', label: 'Колоды', match: ['/decks'] },
  { path: '/friends', label: 'Друзья', match: ['/friends', '/u/'] },
  { path: '/battle', label: 'Бой', match: ['/battle'] },
];

export function PageHeader() {
  const [location] = useLocation();
  return (
    <header className={styles.header}>
      <Link href="/library" className={styles.brand}>
        <Brand size="page" />
      </Link>
      <nav aria-label="Разделы" className={styles.nav}>
        {SECTIONS.map(({ path, label, match }) => {
          const active = match.some((prefix) => location.startsWith(prefix));
          return (
            <Link
              key={path}
              href={path}
              className={cx(styles.navLink, active && styles.active)}
              aria-current={active ? 'page' : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.end}>
        <label className={styles.search} title="Поиск заработает вместе с альбомом">
          <SearchIcon size={16} stroke={2} />
          <input aria-label="Поиск" placeholder="Поиск карточек и друзей" disabled />
        </label>
        <Link href="/u/me" className={styles.profile} aria-label="Мой профиль">
          <UserIcon size={18} />
        </Link>
      </div>
    </header>
  );
}
