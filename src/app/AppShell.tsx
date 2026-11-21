import { Redirect, Route, Router, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AuthGate } from '@/app/AuthGate';
import { AdminPage } from '@/app/pages/AdminPage';
import { Battle } from '@/app/pages/Battle';
import { CardPage } from '@/app/pages/CardPage';
import { DeckBuilder } from '@/app/pages/DeckBuilder';
import { Decks } from '@/app/pages/Decks';
import { Friends } from '@/app/pages/Friends';
import { Home } from '@/app/pages/Home';
import { Library } from '@/app/pages/Library';
import { Profile } from '@/app/pages/Profile';
import { ScanPage } from '@/app/pages/ScanPage';
import { SettingsPage } from '@/app/pages/SettingsPage';
import { AuthProvider } from '@/lib/auth-state';
import { useTheme } from '@/lib/useTheme';
import { PageHeader } from '@/ui/PageHeader';
import styles from './AppShell.module.css';

/** Вкладка приложения: все страницы в одном app.html, маршрут в части адреса после #. */
export function AppShell() {
  useTheme();
  return (
    <AuthProvider>
      <Router hook={useHashLocation}>
        <PageHeader />
        <main className={styles.main}>
          <AuthGate>
            <Switch>
              <Route path="/home" component={Home} />
              <Route path="/library" component={Library} />
              <Route path="/scan" component={ScanPage} />
              <Route path="/card/:id" component={CardPage} />
              <Route path="/friends" component={Friends} />
              <Route path="/u/:uid" component={Profile} />
              <Route path="/decks" component={Decks} />
              <Route path="/decks/:id" component={DeckBuilder} />
              {/* «Боя» нет в навигации, пока по игре нет решения; маршрут остаётся */}
              <Route path="/battle" component={Battle} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/admin" component={AdminPage} />
              {/* Пустой и незнакомый адрес — главная вкладки */}
              <Route>
                <Redirect to="/home" />
              </Route>
            </Switch>
          </AuthGate>
        </main>
      </Router>
    </AuthProvider>
  );
}
