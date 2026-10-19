import { randomUUID } from 'node:crypto';
import type { StoredUser, User, UserStore } from '../src/users.js';

/** UserStore en memoria para las pruebas de la API (el SQL de verdad se prueba en users.integration.test.ts). */
export function createMemoryUserStore(): UserStore {
  let users: StoredUser[] = [];
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const publicUser = ({ passwordHash: _hash, ...user }: StoredUser): User => user;

  return {
    async countUsers() {
      return users.length;
    },
    async createFirstAdmin(input) {
      if (users.length > 0) return null;
      return this.createUser({ ...input, role: 'admin' });
    },
    async createUser(input) {
      const email = input.email.toLowerCase();
      if (users.some((u) => u.email === email)) throw new Error('correo repetido');
      const user: StoredUser = {
        id: randomUUID(),
        email,
        name: input.name,
        role: input.role,
        passwordHash: input.passwordHash,
        createdAt: new Date(),
        mustChangePassword: input.mustChangePassword ?? false,
        workspaceId: input.workspaceId ?? null,
      };
      users.push(user);
      return publicUser(user);
    },
    async findUserByEmail(email) {
      return users.find((u) => u.email === email.toLowerCase()) ?? null;
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session || session.expiresAt.getTime() <= Date.now()) return null;
      const user = users.find((u) => u.id === session.userId);
      return user ? publicUser(user) : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async listUsers() {
      return users.map(publicUser);
    },
    async findUserById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async updateUserRole(id, role) {
      const user = users.find((u) => u.id === id);
      if (!user) return null;
      users = users.map((u) => (u.id === id ? { ...u, role } : u));
      return publicUser({ ...user, role });
    },
    async setPassword(id, passwordHash, mustChange) {
      users = users.map((u) => (u.id === id ? { ...u, passwordHash, mustChangePassword: mustChange } : u));
    },
    async deleteUserSessions(userId, exceptTokenHash) {
      for (const [hash, session] of sessions) if (session.userId === userId && hash !== exceptTokenHash) sessions.delete(hash);
    },
    async deleteUser(id) {
      const before = users.length;
      users = users.filter((u) => u.id !== id);
      for (const [hash, session] of sessions) if (session.userId === id) sessions.delete(hash);
      return users.length < before;
    },
  };
}
