import { useSearchParams } from 'react-router';
import { Tabs } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
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
    <Page>
      <PageHeader
        title="Configuración"
        description="Quién entra y cómo está conectada la cuenta de Instagram."
        actions={<Tabs tabs={TABS} value={tab} onChange={(value) => setParams({ tab: value })} />}
      />
      <div className="mt-6">
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'instagram' && <InstagramTab />}
        {tab === 'registro' && <EventsTab />}
      </div>
    </Page>
  );
}
