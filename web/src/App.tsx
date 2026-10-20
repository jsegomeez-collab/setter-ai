import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ForcedPasswordPage } from './auth/ForcedPasswordPage';
import { LoginPage } from './auth/LoginPage';
import { SessionProvider, useSession } from './auth/SessionContext';
import { ToastProvider } from './ui/Toast';
import { SetupPage } from './auth/SetupPage';
import { HomePage } from './pages/HomePage';
import { PendingModule } from './pages/PendingModule';
import { SetterPage } from './setter/SetterPage';
import { ConversationsPage } from './conversations/ConversationsPage';
import { ContactDetailPage } from './contacts/ContactDetailPage';
import { ContactsPage } from './contacts/ContactsPage';
import { BoardPage } from './leads/BoardPage';
import { MetricsPage } from './metrics/MetricsPage';
import { FlowsPage } from './flows/FlowsPage';
import { IntelligencePage } from './intelligence/IntelligencePage';
import { AccountPage } from './settings/AccountPage';
import { SettingsPage } from './settings/SettingsPage';

// El constructor visual (React Flow) pesa: se descarga solo cuando se abre un flujo.
const FlowEditorPage = lazy(() => import('./flows/FlowEditorPage').then((m) => ({ default: m.FlowEditorPage })));
import { AppShell } from './shell/AppShell';
import { navFor } from './shell/nav';

/** Pantalla de carga como la de la referencia: "Bienvenido" con una línea dorada. */
function Splash({ error }: { error: string | null }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <p className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">
          Bienvenido <span className="text-ember-400">·</span> Setter IA
        </p>
        {error ? (
          <p className="mt-4 text-sm text-bad">{error}</p>
        ) : (
          <div className="mx-auto mt-5 h-[2px] w-56 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-ember-500" />
          </div>
        )}
      </div>
    </div>
  );
}

function Screens() {
  const { loading, loadError, needsSetup, user } = useSession();
  if (loading || loadError) return <Splash error={loadError} />;
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ForcedPasswordPage />;
  const pending = navFor(user.role).filter((item) => item.step !== null);
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        {user.role === 'admin' && <Route path="setter" element={<SetterPage />} />}
        <Route path="conversaciones" element={<ConversationsPage />} />
        <Route path="conversaciones/:igId" element={<ConversationsPage />} />
        <Route path="tablero" element={<BoardPage />} />
        <Route path="contactos" element={<ContactsPage />} />
        <Route path="contactos/:igId" element={<ContactDetailPage />} />
        <Route path="metricas" element={<MetricsPage />} />
        {user.role === 'admin' && <Route path="flujos" element={<FlowsPage />} />}
        {user.role === 'admin' && <Route path="inteligencia" element={<IntelligencePage />} />}
        {user.role === 'admin' && <Route path="configuracion" element={<SettingsPage />} />}
        <Route path="cuenta" element={<AccountPage />} />
        {user.role === 'admin' && (
          <Route
            path="flujos/:id"
            element={
              <Suspense fallback={<p className="p-8 text-sm text-smoke">Cargando el constructor…</p>}>
                <FlowEditorPage />
              </Suspense>
            }
          />
        )}
        {pending.map((item) => (
          <Route key={item.path} path={item.path.slice(1)} element={<PendingModule item={item} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
      <BrowserRouter basename="/app">
        <Screens />
      </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
