import type { User } from 'firebase/auth/web-extension';
import type { Member } from '@/lib/membership';
import { AccountSummary, SettingsSections } from '@/settings/SettingsSections';
import type { ThemeId } from '@/theme/themes';
import { cx } from '@/ui/cx';
import { PopupHeader } from '@/ui/PopupHeader';
import popup from '../Popup.module.css';
import styles from './Settings.module.css';

type Props = {
  user: User;
  member: Member;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  onBack: () => void;
  onSignOut: () => void;
};

/** Настройки в поп-апе. Сами секции общие со страницей #/settings во вкладке (src/settings). */
export function Settings({ user, member, theme, onTheme, onBack, onSignOut }: Props) {
  return (
    <>
      <PopupHeader title="Настройки" onBack={onBack} />
      <main className={cx(popup.body, styles.scroll)}>
        <SettingsSections layout="popup" theme={theme} onTheme={onTheme} />
      </main>

      <footer className={styles.footer}>
        <AccountSummary layout="popup" user={user} member={member} onSignOut={onSignOut} />
      </footer>
    </>
  );
}
