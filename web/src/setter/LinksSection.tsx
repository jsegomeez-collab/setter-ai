import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../ui/Toast';
import { Notice, Section } from '../ui/kit';
import type { SetterLinks } from './types';

/**
 * Enlaces del setter de este espacio (Fase 7.5c): la agenda y la membresía van en botones, y el correo en las
 * respuestas. Sin los tres puestos, el setter no responde (en un espacio nuevo no hay ninguno al empezar).
 */
export function LinksSection({ links, onSaved }: { links: SetterLinks; onSaved: () => void }) {
  const toast = useToast();
  const [agenda, setAgenda] = useState(links.agenda);
  const [membership, setMembership] = useState(links.membership);
  const [contactEmail, setContactEmail] = useState(links.contactEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = Boolean(links.agenda && links.membership && links.contactEmail);
  const dirty = agenda !== links.agenda || membership !== links.membership || contactEmail !== links.contactEmail;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/setter/links', { method: 'POST', body: { agenda: agenda.trim(), membership: membership.trim(), contactEmail: contactEmail.trim() } });
      toast('Enlaces guardados.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      label="Tus enlaces"
      description={
        links.source === 'saved'
          ? 'La agenda y la membresía salen en botones; el correo, cuando alguien tiene una duda que no se resuelve por chat.'
          : 'Ahora se usan los enlaces por defecto. Pon los tuyos: la agenda y la membresía salen en botones y el correo para dudas.'
      }
    >
      {!complete && <Notice tone="warn">Faltan enlaces: hasta que pongas los tres, el setter no responde a nadie.</Notice>}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Agenda (llamada)</span>
          <input className="field" type="url" placeholder="https://…" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Membresía</span>
          <input className="field" type="url" placeholder="https://…" value={membership} onChange={(e) => setMembership(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Correo de contacto</span>
          <input className="field" type="email" placeholder="correo@ejemplo.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="mt-3 inline-flex min-h-[40px] items-center rounded-[10px] border border-white/10 px-4 text-[13px] font-semibold text-mist hover:text-fog disabled:opacity-40">
        {busy ? 'Guardando…' : 'Guardar enlaces'}
      </button>
    </Section>
  );
}
