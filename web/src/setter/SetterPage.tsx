import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { Notice, SecondaryButton, Tabs } from '../ui/kit';
import { ModeTab } from './ModeTab';
import { OpenerTab } from './OpenerTab';
import { SimulatorTab } from './SimulatorTab';
import type { SaveResponse, SetterData } from './types';
import { VersionedTextTab } from './VersionedTextTab';

const MAX_DOCUMENT_CHARS = 60_000;
const MAX_FRAME_CHARS = 20_000;

type TabId = 'modo' | 'documento' | 'marco' | 'inicio' | 'simulador';
const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'modo', label: 'Modo' },
  { value: 'documento', label: 'Documento' },
  { value: 'marco', label: 'Marco técnico' },
  { value: 'inicio', label: 'Inicio' },
  { value: 'simulador', label: 'Simulador' },
];

const FRAME_HELP = (
  <>
    Las instrucciones fijas que acompañan al documento. Los enlaces van como <code className="text-ember-300">[LINK AGENDA]</code>,{' '}
    <code className="text-ember-300">[LINK MEMBRESÍA]</code> y <code className="text-ember-300">[CORREO]</code> y se rellenan solos. Las reglas automáticas
    (muletillas, membresía, agenda una vez…) siguen activas aunque cambies esto.
  </>
);

/** Módulo Setter IA (Fase 6.1): modo, documento, marco técnico, textos de inicio y simulador. Solo admin. */
export function SetterPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'modo') as TabId;
  const [data, setData] = useState<SetterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** Sube al recargar: las pestañas vuelven a empezar con los datos nuevos. */
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api<SetterData>('/setter'));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el setter');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = (message: string) => {
    setFlash(message);
    void load();
  };

  async function resetFrame() {
    if (!window.confirm('¿Volver al marco técnico original? Tu versión queda en el historial.')) return;
    const result = await api<SaveResponse>('/setter/frame/reset', { method: 'POST', body: {} }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo volver al original');
      return null;
    });
    if (result) saved(result.unchanged ? 'Ya estaba el original.' : 'Marco técnico: vuelta al original.');
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">Setter IA</h1>
          <p className="mt-1 text-sm text-ash">Cómo habla la IA por DM y cuándo empieza a escribir.</p>
        </div>
        <Tabs tabs={TABS} value={tab} onChange={(value) => setParams({ tab: value })} />
      </div>

      <div className="mt-6 space-y-4">
        {flash && <Notice tone="ok">{flash}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {!data && !error && <p className="text-sm text-smoke">Cargando…</p>}
        {data && tab === 'modo' && <ModeTab key={version} data={data} onSaved={saved} />}
        {data && tab === 'documento' && (
          <VersionedTextTab
            key={version}
            endpoint="/setter/knowledge"
            label="Documento del setter"
            description="Oferta, tono, preguntas, objeciones… Es lo principal que lee la IA en cada respuesta."
            text={data.knowledge?.text ?? ''}
            maxChars={MAX_DOCUMENT_CHARS}
            versions={data.knowledgeVersions}
            onSaved={saved}
          />
        )}
        {data && tab === 'marco' && (
          <VersionedTextTab
            key={version}
            endpoint="/setter/frame"
            label={data.frame.isDefault ? 'Marco técnico · original' : 'Marco técnico · personalizado'}
            description={FRAME_HELP}
            text={data.frame.text}
            maxChars={MAX_FRAME_CHARS}
            versions={data.frameVersions}
            onSaved={saved}
            extraAction={
              !data.frame.isDefault && (
                <SecondaryButton onClick={() => void resetFrame()}>
                  <RotateCcw size={13} /> Volver al original
                </SecondaryButton>
              )
            }
          />
        )}
        {data && tab === 'inicio' && <OpenerTab key={version} openers={data.openers} onSaved={saved} />}
        {data && tab === 'simulador' && <SimulatorTab key={version} data={data} />}
      </div>
    </div>
  );
}
