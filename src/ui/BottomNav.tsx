import type { ComponentType } from 'react';
import { appUrl, openAppFromPopup } from '@/lib/tabs';
import { cx } from '@/ui/cx';
import { AlbumIcon, DecksIcon, FriendsIcon, HomeIcon } from '@/ui/Icons';
import styles from './BottomNav.module.css';

/** Разделы, которые открываются во вкладке приложения. «Боя» нет, пока по игре нет решения. */
const TAB_SECTIONS: Array<{ path: string; label: string; Icon: ComponentType }> = [
  { path: '/library', label: 'Альбом', Icon: AlbumIcon },
  { path: '/decks', label: 'Колоды', Icon: DecksIcon },
  { path: '/friends', label: 'Друзья', Icon: FriendsIcon },
];

/** Нижнее меню поп-апа: «Главная» здесь же, остальное во вкладке. */
export function BottomNav() {
  return (
    <nav aria-label="Разделы" className={styles.nav}>
      <span className={cx(styles.item, styles.current)} aria-current="page">
        <HomeIcon />
        Главная
      </span>
      {TAB_SECTIONS.map(({ path, label, Icon }) => (
        <a
          key={path}
          href={appUrl(path)}
          className={styles.item}
          onClick={(event) => {
            event.preventDefault();
            void openAppFromPopup(path);
          }}
        >
          <Icon />
          {label}
        </a>
      ))}
    </nav>
  );
}
