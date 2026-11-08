import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Preferences, ProfileDTO, SessionDTO, UserDTO } from '@whatif/shared';
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from '../api/client';
import { setNumberLocale } from './format';

interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: UserDTO | null;
  profile: ProfileDTO | null;
  preferences: Preferences;
  setSession: (s: SessionDTO) => void;
  updateProfile: (p: ProfileDTO) => void;
  updatePreferences: (p: Preferences) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function applyTheme(theme: Preferences['theme']) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem('whatif.theme', theme);
    else localStorage.removeItem('whatif.theme');
  } catch {
    /* storage unavailable — theme still applies for this page */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [user, setUser] = useState<UserDTO | null>(null);
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({});

  const setSession = useCallback((s: SessionDTO) => {
    setCsrfToken(s.csrfToken);
    setUser(s.user);
    setProfile(s.profile);
    setPreferences(s.preferences);
    setNumberLocale(s.preferences.numberLocale);
    applyTheme(s.preferences.theme);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setCsrfToken('');
    setUser(null);
    setProfile(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  const refresh = useCallback(async () => {
    try {
      const s = await api<SessionDTO>('GET', '/auth/session', undefined, { quiet401: true });
      setSession(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) clear();
      else setStatus((st) => (st === 'loading' ? 'anonymous' : st));
    }
  }, [setSession, clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => clear());
  }, [clear]);

  const signOut = useCallback(async () => {
    try {
      await api('POST', '/auth/logout', {});
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      user,
      profile,
      preferences,
      setSession,
      updateProfile: setProfile,
      updatePreferences: (p) => {
        setPreferences(p);
        setNumberLocale(p.numberLocale);
        applyTheme(p.theme);
      },
      signOut,
      refresh,
    }),
    [status, user, profile, preferences, setSession, signOut, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
