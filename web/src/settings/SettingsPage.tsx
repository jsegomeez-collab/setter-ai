import { useSearchParams } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { Tabs } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { EventsTab } from './EventsTab';
import { InstagramTab } from './InstagramTab';
import { UsersTab } from './UsersTab';
import { WorkspacesTab } from './WorkspacesTab';

/** Configuración (Fase 6.7, solo admin). "Espacios" (7.5b) solo sale en el espacio de Jose. */

type TabId = 'usuarios' | 'instagram' | 'registro' | 'espacios';
const BASE_TABS: readonly { value: TabId; label: string }[] = [
  { value: 'usuarios', label: 'Usuarios' },
  { value: 'instagram', label: 'Instagram y envíos' },
  { value: 'registro', label: 'Registro' },
];

export function SettingsPage() {
  const { workspace } = useSession();
  const [params, setParams] = useSearchParams();
  // Por dentro son "espacios"; Jose los ve como "Clientes" (7.5f). La dirección ?tab=espacios se mantiene.
  const tabs = workspace ? BASE_TABS : [...BASE_TABS, { value: 'espacios' as const, label: 'Clientes' }];
  const tab: TabId = tabs.some((t) => t.value === params.get('tab')) ? (params.get('tab') as TabId) : 'usuarios';
  return (
    <Page>
      <PageHeader
        title="Configuración"
        description={workspace ? `Quién entra en «${workspace.name}» y cómo está conectada su cuenta de Instagram.` : 'Quién entra, cómo está conectada la cuenta de Instagram y tus clientes.'}
        actions={<Tabs tabs={tabs} value={tab} onChange={(value) => setParams({ tab: value })} />}
      />
      <div className="mt-6">
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'instagram' && <InstagramTab />}
        {tab === 'registro' && <EventsTab />}
        {tab === 'espacios' && <WorkspacesTab />}
      </div>
    </Page>
  );
}
