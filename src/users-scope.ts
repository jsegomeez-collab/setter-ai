import type { StoredUser, UserStore } from './users.js';

/**
 * Usuarios vistos desde un espacio (Fase 7.5a). El inicio de sesión y las sesiones son uno para todos (un correo,
 * una cuenta), pero cada espacio solo lista, crea y gestiona a su gente. `workspaceId` null = el principal (Jose).
 * Así las rutas de usuarios (6.7) sirven tal cual en cada espacio sin saber que hay varios.
 */
export function scopeUsers(users: UserStore, workspaceId: string | null): UserStore {
  const mine = (user: { readonly workspaceId: string | null } | null): boolean => user !== null && (user.workspaceId ?? null) === workspaceId;
  const ownUser = async (id: string): Promise<StoredUser | null> => {
    const user = await users.findUserById(id);
    return mine(user) ? user : null;
  };
  return {
    countUsers: () => users.countUsers(),
    // El primer admin de todo es el de Jose (principal): en otro espacio no hay "primer alta".
    createFirstAdmin: async (input) => (workspaceId === null ? users.createFirstAdmin(input) : null),
    createUser: (input) => users.createUser({ ...input, workspaceId }),
    findUserByEmail: (email) => users.findUserByEmail(email),
    createSession: (tokenHash, userId, expiresAt) => users.createSession(tokenHash, userId, expiresAt),
    findSession: (tokenHash) => users.findSession(tokenHash),
    deleteSession: (tokenHash) => users.deleteSession(tokenHash),
    listUsers: async () => (await users.listUsers()).filter(mine),
    findUserById: ownUser,
    updateUserRole: async (id, role) => ((await ownUser(id)) ? users.updateUserRole(id, role) : null),
    setPassword: async (id, passwordHash, mustChange) => {
      if (await ownUser(id)) await users.setPassword(id, passwordHash, mustChange);
    },
    deleteUserSessions: async (userId, exceptTokenHash) => {
      if (await ownUser(userId)) await users.deleteUserSessions(userId, exceptTokenHash);
    },
    deleteUser: async (id) => ((await ownUser(id)) ? users.deleteUser(id) : false),
  };
}
