import { useState } from 'react';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { useSession } from '../auth/SessionContext';
import { ROLE_LABEL } from '../lib/api';
import { Notice, Section } from '../ui/kit';

/** Mi cuenta (Fase 6.7): para todos. Cambiar la propia clave cierra las demás sesiones abiertas. */
export function AccountPage() {
  const { user } = useSession();
  const [done, setDone] = useState(false);
  if (!user) return null;
  return (
    <div className="mx-auto w-full max-w-[640px] px-5 py-8 lg:py-10">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">Mi cuenta</h1>
      <p className="mt-1 text-sm text-ash">
        {user.name} · {user.email} · {ROLE_LABEL[user.role]}
      </p>
      <div className="mt-6 space-y-4">
        {done && <Notice tone="ok">Clave cambiada. Las demás sesiones abiertas se han cerrado.</Notice>}
        <Section label="Cambiar mi clave">
          <ChangePasswordForm onDone={() => setDone(true)} />
        </Section>
      </div>
    </div>
  );
}
