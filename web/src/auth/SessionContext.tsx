import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type SessionInfo, type SessionUser, type SessionWorkspace } from '../lib/api';

interface SetupInput {
  readonly setupKey: string;
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

interface SessionValue {
  readonly loading: boolean;
  /** No hay ningún usuario todavía: toca el alta del primer admin. */
  readonly needsSetup: boolean;
  readonly user: SessionUser | null;
  /** Espacio en el que está (Fase 7.5). null = el principal (el de Jose). */
  readonly workspace: SessionWorkspace | null;
  /** No se pudo hablar con el servidor al cargar. */
  readonly loadError: string | null;
  login(email: string, password: string): Promise<void>;
  setup(input: SetupInput): Promise<void>;
  logout(): Promise<void>;
  /** Tras cambiar la clave temporal: ya puede entrar al resto. */
  passwordChanged(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<SessionInfo>('/session')
      .then(setInfo)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'No se pudo conectar con el servidor'));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await api<{ user: SessionUser }>('/login', { method: 'POST', body: { email, password } });
    // El inicio de sesión lo atiende el espacio principal: se vuelve a preguntar para saber el espacio de esta persona.
    setInfo(await api<SessionInfo>('/session'));
  }, []);

  const setup = useCallback(async (input: SetupInput) => {
    const { user } = await api<{ user: SessionUser }>('/setup', { method: 'POST', body: input });
    setInfo({ needsSetup: false, user });
  }, []);

  const logout = useCallback(async () => {
    await api('/logout', { method: 'POST', body: {} });
    setInfo({ needsSetup: false, user: null });
  }, []);

  const passwordChanged = useCallback(() => {
    setInfo((current) => (current?.user ? { ...current, user: { ...current.user, mustChangePassword: false } } : current));
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ loading: info === null && loadError === null, needsSetup: info?.needsSetup ?? false, user: info?.user ?? null, workspace: info?.workspace ?? null, loadError, login, setup, logout, passwordChanged }),
    [info, loadError, login, setup, logout, passwordChanged],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession fuera de SessionProvider');
  return value;
}
