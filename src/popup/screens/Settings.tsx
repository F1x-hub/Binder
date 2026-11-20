import type { User } from 'firebase/auth/web-extension';
import { useId } from 'react';
import { invitesLeftLabel } from '@/lib/format';
import type { Member } from '@/lib/membership';
import type { ThemeId } from '@/theme/themes';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { DeepseekKeyField } from '@/scan/DeepseekKeyField';
import { JusttcgKeyField } from '@/scan/JusttcgKeyField';
import { cx } from '@/ui/cx';
import { PopupHeader } from '@/ui/PopupHeader';
import { ThemePicker } from '@/ui/ThemePicker';
import popup from '../Popup.module.css';
import styles from './Settings.module.css';

const PHOTO_STORES = [
  { id: 'none', label: 'Не хранить, только для сканера' },
  { id: 'drive', label: 'Сохранять в мой Google Drive' },
  { id: 'cloud', label: 'Сохранять превью в облаке Binder' },
] as const;

type Props = {
  user: User;
  member: Member;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  onBack: () => void;
  onSignOut: () => void;
};

export function Settings({ user, member, theme, onTheme, onBack, onSignOut }: Props) {
  const themeTitle = useId();
  const photosTitle = useId();

  return (
    <>
      <PopupHeader title="Настройки" onBack={onBack} />
      <main className={cx(popup.body, styles.scroll)}>
        <DeepseekKeyField />
        <JusttcgKeyField />

        <section className={styles.section}>
          <h2 id={themeTitle} className={styles.title}>
            Тема
          </h2>
          <ThemePicker value={theme} onChange={onTheme} labelledBy={themeTitle} />
        </section>

        <section className={styles.photos}>
          <h2 id={photosTitle} className={styles.title}>
            Мои фото карточек
          </h2>
          <div role="radiogroup" aria-labelledby={photosTitle} className={styles.radios}>
            {PHOTO_STORES.map(({ id, label }) => (
              <label key={id} className={styles.radio}>
                <input type="radio" name="photo-store" value={id} defaultChecked={id === 'none'} disabled />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className={styles.note}>Хранение фото появится позже. Сейчас фото нужно только сканеру.</p>
        </section>
      </main>

      <footer className={styles.footer}>
        <Avatar src={user.photoURL} size={36} />
        <div className={styles.account}>
          <span className={styles.accountName}>{user.email ?? 'Без почты'}</span>
          <span className={styles.accountNote}>{invitesLeftLabel(member.invitesLeft)}</span>
        </div>
        <Button variant="link" className={styles.signOut} onClick={onSignOut}>
          Выйти
        </Button>
      </footer>
    </>
  );
}
