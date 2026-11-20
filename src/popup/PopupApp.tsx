import type { User } from 'firebase/auth/web-extension';
import { useState } from 'react';
import { signOutOfBinder } from '@/lib/auth';
import { AuthProvider, useAuth } from '@/lib/auth-state';
import { CollectionProvider, useOwned } from '@/lib/collection-state';
import { MembershipProvider, useMembership } from '@/lib/membership-state';
import { openAppFromPopup } from '@/lib/tabs';
import { useTheme } from '@/lib/useTheme';
import type { ThemeId } from '@/theme/themes';
import { Home } from '@/popup/screens/Home';
import { Join } from '@/popup/screens/Join';
import { Settings } from '@/popup/screens/Settings';
import { Welcome } from '@/popup/screens/Welcome';
import { ScanFlow } from '@/scan/ScanFlow';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Popup.module.css';

type Screen = { name: 'home' } | { name: 'scan'; files?: File[] } | { name: 'settings' };

export function PopupApp() {
  return (
    <AuthProvider>
      <PopupScreens />
    </AuthProvider>
  );
}

function PopupScreens() {
  const [theme, setTheme] = useTheme();
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const signOut = async () => {
    setScreen({ name: 'home' });
    await signOutOfBinder().catch((error: unknown) => console.warn('[binder] выход', error));
  };

  return (
    <div className={styles.frame}>
      {auth.status === 'signed-out' && <Welcome />}
      {auth.status === 'unavailable' && <Problem title="Firebase не настроен" text={auth.message} />}
      {auth.status === 'signed-in' && (
        <MembershipProvider uid={auth.user.uid}>
          <MemberScreens
            user={auth.user}
            screen={screen}
            onScreen={setScreen}
            theme={theme}
            onTheme={setTheme}
            onSignOut={() => void signOut()}
          />
        </MembershipProvider>
      )}
    </div>
  );
}

type MemberScreensProps = {
  user: User;
  screen: Screen;
  onScreen: (screen: Screen) => void;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  onSignOut: () => void;
};

/** Экраны после входа: участнику открыт клуб, остальным нужен код приглашения. */
function MemberScreens({ user, screen, onScreen, theme, onTheme, onSignOut }: MemberScreensProps) {
  const membership = useMembership();

  if (membership.status === 'loading') return null;
  if (membership.status === 'error') {
    return <Problem title="Не получилось проверить членство" text={membership.message} />;
  }
  if (membership.status === 'not-member') return <Join user={user} onSignOut={onSignOut} />;

  return (
    <CollectionProvider uid={user.uid}>
      {screen.name === 'scan' && (
        <PopupScan uid={user.uid} files={screen.files} onBack={() => onScreen({ name: 'home' })} />
      )}
      {screen.name === 'settings' && (
        <Settings
          user={user}
          member={membership.member}
          theme={theme}
          onTheme={onTheme}
          onBack={() => onScreen({ name: 'home' })}
          onSignOut={onSignOut}
        />
      )}
      {screen.name === 'home' && (
        <Home onScan={(files) => onScreen({ name: 'scan', files })} onSettings={() => onScreen({ name: 'settings' })} />
      )}
    </CollectionProvider>
  );
}

function PopupScan({ uid, files, onBack }: { uid: string; files?: File[]; onBack: () => void }) {
  const { byId } = useOwned();
  return (
    <ScanFlow
      uid={uid}
      owned={byId}
      initialFiles={files}
      onBack={onBack}
      onOpenAlbum={() => void openAppFromPopup('/library')}
    />
  );
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <main className={styles.body}>
      <EmptyState title={title}>{text}</EmptyState>
    </main>
  );
}
