import { AuthScreen } from './AuthScreen';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useSession } from './SessionContext';

/** Primera entrada con clave temporal: hasta cambiarla no se ve nada más (el servidor tampoco deja hacer nada). */
export function ForcedPasswordPage() {
  const { user, logout } = useSession();
  return (
    <AuthScreen title={`Hola, ${user?.name ?? ''}`} subtitle="Entraste con una clave temporal. Pon una tuya para continuar.">
      <ChangePasswordForm currentLabel="Clave temporal (la que te dieron)" />
      <button type="button" onClick={() => void logout()} className="mt-4 w-full text-center text-[13px] text-ash hover:text-fog">
        Salir
      </button>
    </AuthScreen>
  );
}
