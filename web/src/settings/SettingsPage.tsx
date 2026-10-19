import { useSearchParams } from 'react-router';
import { Tabs } from '../ui/kit';
import { EventsTab } from './EventsTab';
import { InstagramTab } from './InstagramTab';
import { UsersTab } from './UsersTab';

/** Configuración (Fase 6.7, solo admin). */

type TabId = 'usuarios' | 'instagram' | 'registro';
const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'usuarios', label: 'Usuarios' },
  { value: 'instagram', label: 'Instagram y envíos' },
  { value: 'registro', label: 'Registro' },
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.value === params.get('tab')) ? (params.get('tab') as TabId) : 'usuarios';
  return (
    <div className="mx-auto w-full max-w-[1150px] px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">Configuración</h1>
          <p className="mt-1 text-sm text-ash">Quién entra y cómo está conectada la cuenta de Instagram.</p>
        </div>
        <Tabs tabs={TABS} value={tab} onChange={(value) => setParams({ tab: value })} />
      </div>
      <div className="mt-6">
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'instagram' && <InstagramTab />}
        {tab === 'registro' && <EventsTab />}
      </div>
    </div>
  );
}
