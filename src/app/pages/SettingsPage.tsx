import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useMembership } from '@/lib/membership-state';
import { useTheme } from '@/lib/useTheme';
import { leaveBinder } from '@/settings/leave';
import { AccountSummary, SettingsSections } from '@/settings/SettingsSections';
import styles from './Page.module.css';

/**
 * Настройки во вкладке, #/settings. Секции те же, что в поп-апе (src/settings),
 * тема общая через chrome.storage.sync: смена здесь сразу видна в поп-апе и наоборот.
 */
export function SettingsPage() {
  usePageTitle('Настройки');
  const [theme, setTheme] = useTheme();
  const auth = useAuth();
  const membership = useMembership();

  return (
    <>
      <h1 className={styles.title}>Настройки</h1>
      <div className={styles.split}>
        <SettingsSections layout="page" theme={theme} onTheme={setTheme} />
        {auth.status === 'signed-in' && membership.status === 'member' && (
          <aside className={styles.side}>
            <AccountSummary layout="page" user={auth.user} member={membership.member} onSignOut={leaveBinder} />
          </aside>
        )}
      </div>
    </>
  );
}
