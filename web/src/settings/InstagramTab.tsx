import { Ban, CheckCircle2, PlayCircle, RefreshCw, Radio, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Notice, Section, SecondaryButton, formatDate } from '../ui/kit';

/**
 * Configuración · Instagram y envíos (Fase 6.7b). Decisión de Jose: los límites por hora solo se ven (se cambian en
 * Render); la pausa del 368 y el bloqueo de envíos se quitan o se ponen escribiendo una palabra.
 */

interface Status {
  readonly account: { readonly userId: string; readonly username: string } | null;
  readonly accountError: string | null;
  readonly secretConfigured: boolean;
  readonly linkTracking: boolean;
  readonly setterKey: boolean;
  readonly token: { readonly source: string; readonly refreshedAt: string | null; readonly expiresAt: string | null; readonly lastError: string | null; readonly encryptionConfigured: boolean };
  readonly pause: { readonly until: string; readonly reason: string | null } | null;
  readonly block: { readonly until: string; readonly reason: string | null } | null;
  readonly sends: { readonly privateReplies: number; readonly publicReplies: number; readonly followUps: number };
  readonly limits: { readonly privateReplies: number; readonly publicReplies: number; readonly followUps: number };
  readonly flows: { readonly active: number; readonly total: number };
}

type Dialog = 'resume' | 'unblock' | 'block' | null;
const DAY_MS = 24 * 60 * 60 * 1000;

export function InstagramTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [blockDays, setBlockDays] = useState(7);
  const [blockReason, setBlockReason] = useState('');

  const load = () =>
    api<Status>('/settings/status')
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<string>) => {
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      setDialog(null);
      await load();
    } catch (err) {
      setDialog(null);
      setError(err instanceof Error ? err.message : 'Algo falló');
    }
  };

  if (error && !status) return <Notice tone="bad">{error}</Notice>;
  if (!status) return <p className="text-sm text-smoke">Cargando…</p>;
  const { token } = status;
  const daysLeft = token.expiresAt ? Math.floor((Date.parse(token.expiresAt) - Date.now()) / DAY_MS) : null;

  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <Section label="Cuenta de Instagram">
        <ul className="space-y-2 text-sm">
          <Check ok={status.account !== null}>{status.account ? <>Conectada como <strong className="text-fog">@{status.account.username}</strong></> : `Sin conectar: ${status.accountError}`}</Check>
          <Check ok={status.secretConfigured}>Firma de los avisos de Meta {status.secretConfigured ? 'configurada' : 'SIN configurar'}</Check>
          <Check ok={status.linkTracking}>Seguimiento de clics en enlaces {status.linkTracking ? 'activo' : 'desactivado'}</Check>
          <Check ok={status.setterKey}>Clave de Anthropic (setter IA) {status.setterKey ? 'configurada' : 'SIN configurar'}</Check>
          <Check ok>Flujos activos: {status.flows.active} de {status.flows.total}</Check>
        </ul>
        <div className="mt-4">
          <SecondaryButton onClick={() => void run(async () => `Avisos de Meta: ${JSON.stringify((await api<{ result: unknown }>('/settings/subscribe', { method: 'POST' })).result)}`)}>
            <Radio size={14} /> Volver a suscribir los avisos de Meta
          </SecondaryButton>
          <p className="mt-1 text-xs text-smoke">Solo si dejan de llegar comentarios o mensajes. No hace nada malo si se pulsa de más.</p>
        </div>
      </Section>

      <Section label="Token de Instagram" description="Se renueva solo cada pocos días. El botón es por si falla.">
        <ul className="space-y-1.5 text-sm text-mist">
          <li>Origen: {token.source}</li>
          <li>Última renovación: {token.refreshedAt ? formatDate(token.refreshedAt) : '—'}</li>
          <li className={daysLeft !== null && daysLeft < 10 ? 'text-warn' : undefined}>
            Caduca: {token.expiresAt ? `${formatDate(token.expiresAt)} (en ${daysLeft} días)` : 'desconocido'}
          </li>
          {token.lastError && <li className="text-bad">Último error: {token.lastError}</li>}
          {!token.encryptionConfigured && <li className="text-warn">Falta TOKEN_ENCRYPTION_KEY en Render: no se puede guardar el token renovado.</li>}
        </ul>
        <div className="mt-4">
          <SecondaryButton onClick={() => void run(async () => (await api<{ message: string }>('/settings/token/refresh', { method: 'POST' })).message)}>
            <RefreshCw size={14} /> Renovar ahora
          </SecondaryButton>
        </div>
      </Section>

      <Section label="Envíos" description="Los límites por hora se cambian en Render (variables de entorno); aquí solo se ven.">
        <div className="space-y-3">
          {status.block ? (
            <StateRow tone="warn" icon={<Ban size={16} />} text={<>Envíos <strong>bloqueados</strong> hasta el {formatDate(status.block.until)}{status.block.reason ? ` · ${status.block.reason}` : ''}</>} action={<SecondaryButton onClick={() => setDialog('unblock')}>Quitar el bloqueo</SecondaryButton>} />
          ) : (
            <StateRow tone="ok" icon={<CheckCircle2 size={16} />} text="Sin bloqueo largo de envíos." action={<SecondaryButton onClick={() => setDialog('block')}>Bloquear envíos…</SecondaryButton>} />
          )}
          {status.pause ? (
            <StateRow tone="warn" icon={<PlayCircle size={16} />} text={<>Pausa automática (Meta 368) hasta el {formatDate(status.pause.until)}{status.pause.reason ? ` · ${status.pause.reason}` : ''}</>} action={<SecondaryButton onClick={() => setDialog('resume')}>Reanudar ya</SecondaryButton>} />
          ) : (
            <StateRow tone="ok" icon={<CheckCircle2 size={16} />} text="Sin pausa automática." />
          )}
        </div>
        <table className="mt-5 w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-white/[0.07] text-xs text-smoke">
              <th className="py-2 font-semibold">Última hora</th>
              <th className="py-2 text-right font-semibold">Enviados</th>
              <th className="py-2 text-right font-semibold">Límite por hora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05] text-mist">
            <LimitRow label="DMs a comentarios" used={status.sends.privateReplies} limit={status.limits.privateReplies} />
            <LimitRow label="Respuestas públicas" used={status.sends.publicReplies} limit={status.limits.publicReplies} />
            <LimitRow label="Mensajes por DM (flujo, IA, a mano)" used={status.sends.followUps} limit={status.limits.followUps} />
          </tbody>
        </table>
      </Section>

      {dialog === 'resume' && (
        <ConfirmDialog title="Reanudar los envíos" word="REANUDAR" confirmLabel="Reanudar" onConfirm={() => void run(async () => (await api('/settings/pause/clear', { method: 'POST', body: { confirm: 'REANUDAR' } }), 'Envíos reanudados.'))} onCancel={() => setDialog(null)}>
          <p>Meta pausó los envíos por exceso (código 368). Reanudar antes de tiempo puede alargar el castigo.</p>
        </ConfirmDialog>
      )}
      {dialog === 'unblock' && (
        <ConfirmDialog title="Quitar el bloqueo de envíos" word="QUITAR" confirmLabel="Quitar el bloqueo" tone="bad" onConfirm={() => void run(async () => (await api('/conversations/sends-block', { method: 'POST', body: { until: null, reason: null } }), 'Bloqueo quitado: los envíos vuelven a salir.'))} onCancel={() => setDialog(null)}>
          <p>Volverán a salir los mensajes de los flujos activos, la IA y las respuestas a mano. Si el bloqueo es el de Meta, asegúrate de que ya terminó.</p>
        </ConfirmDialog>
      )}
      {dialog === 'block' && (
        <ConfirmDialog
          title="Bloquear todos los envíos"
          word="BLOQUEAR"
          confirmLabel="Bloquear"
          tone="bad"
          onConfirm={() =>
            void run(async () => {
              const until = new Date(Date.now() + blockDays * DAY_MS).toISOString();
              await api('/conversations/sends-block', { method: 'POST', body: { until, reason: blockReason.trim() || null } });
              return `Envíos bloqueados durante ${blockDays} día(s).`;
            })
          }
          onCancel={() => setDialog(null)}
        >
          <p>No saldrá ningún mensaje (flujos, IA ni a mano) hasta la fecha. Los comentarios y mensajes se siguen guardando.</p>
          <div className="flex gap-2">
            <label className="text-xs text-ash">
              Días
              <input type="number" min={1} max={60} className="field mt-1 !w-20 !py-1.5" value={blockDays} onChange={(e) => setBlockDays(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
            <label className="flex-1 text-xs text-ash">
              Motivo (opcional)
              <input className="field mt-1 !py-1.5" maxLength={300} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-mist">
      {ok ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <XCircle size={15} className="shrink-0 text-bad" />}
      <span>{children}</span>
    </li>
  );
}

function StateRow({ tone, icon, text, action }: { tone: 'ok' | 'warn'; icon: ReactNode; text: ReactNode; action?: ReactNode }) {
  return (
    <div className={['flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-sm', tone === 'warn' ? 'border-warn/30 bg-warn/[0.07] text-warn' : 'border-white/8 text-mist'].join(' ')}>
      {icon}
      <span className="flex-1">{text}</span>
      {action}
    </div>
  );
}

function LimitRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <tr>
      <td className="py-2">{label}</td>
      <td className="py-2 text-right tabular-nums text-fog">{used}</td>
      <td className="py-2 text-right tabular-nums">{limit}</td>
    </tr>
  );
}
