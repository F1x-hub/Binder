import { onAuthStateChanged, type User } from 'firebase/auth/web-extension';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { binderAuth } from '@/lib/firebase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User }
  | { status: 'unavailable'; message: string };

const AuthContext = createContext<AuthState>({ status: 'loading' });

/**
 * Состояние входа для окна. Пока Firebase не восстановил сессию из IndexedDB, статус loading,
 * и данные пользователя не читаются: в прошлом расширении на этом была гонка.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let stop = () => {};
    try {
      const auth = binderAuth();
      void auth.authStateReady().then(() => {
        if (!active) return;
        stop = onAuthStateChanged(auth, (user) => {
          setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
        });
      });
    } catch (error) {
      setState({ status: 'unavailable', message: error instanceof Error ? error.message : String(error) });
    }
    return () => {
      active = false;
      stop();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
