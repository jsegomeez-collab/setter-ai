import { useState } from 'react';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { useSession } from '../auth/SessionContext';
import { ROLE_LABEL } from '../lib/api';
import { Notice, Section } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';

/** Mi cuenta (Fase 6.7): para todos. Cambiar la propia clave cierra las demás sesiones abiertas. */
export function AccountPage() {
  const { user } = useSession();
  const [done, setDone] = useState(false);
  if (!user) return null;
  return (
    <Page>
      <PageHeader title="Mi cuenta" description={`${user.name} · ${user.email} · ${ROLE_LABEL[user.role]}`} />
      <div className="mt-6 space-y-4">
        {done && <Notice tone="ok">Clave cambiada. Las demás sesiones abiertas se han cerrado.</Notice>}
        <Section label="Cambiar mi clave">
          <ChangePasswordForm onDone={() => setDone(true)} />
        </Section>
      </div>
    </Page>
  );
}
