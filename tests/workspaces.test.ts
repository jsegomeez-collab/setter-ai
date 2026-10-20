import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabaseSql, createPostgresWorkspaceRegistry, databaseUrlFor, dropDatabaseSql, newWorkspaceId, type WorkspaceRegistry } from '../src/workspaces.js';

/** Fase 7.5a: lista de espacios (en la base principal) y la base de datos propia de cada uno. */

describe('identificador y base de datos de un espacio', () => {
  it('el id sale del nombre: minúsculas, sin tildes, con prefijo ws_ y un final al azar', () => {
    expect(newWorkspaceId('Socio Pérez & Co', () => 'a1b2')).toBe('ws_socio_perez_co_a1b2');
    expect(newWorkspaceId('!!!', () => 'zz99')).toBe('ws_espacio_zz99');
    expect(newWorkspaceId('x'.repeat(80), () => 'a1b2')).toMatch(/^ws_x{30}_a1b2$/);
  });

  it('la URL de su base es la principal cambiando solo el nombre de la base', () => {
    expect(databaseUrlFor('postgres://u:p@host.neon.tech/neondb?sslmode=require', 'ws_socio_a1b2')).toBe('postgres://u:p@host.neon.tech/ws_socio_a1b2?sslmode=require');
  });

  it('crear la base solo acepta ids seguros (nada de inyectar SQL)', () => {
    expect(createDatabaseSql('ws_socio_a1b2')).toBe('CREATE DATABASE "ws_socio_a1b2"');
    expect(() => createDatabaseSql('ws_x"; DROP DATABASE neondb; --')).toThrow();
    expect(() => createDatabaseSql('principal')).toThrow();
  });
});

const PORT = 54333;
let db: PGlite;
let server: PGLiteSocketServer;
let registry: WorkspaceRegistry & { close(): Promise<void> };

describe('createPostgresWorkspaceRegistry (Postgres real)', () => {
  beforeAll(async () => {
    db = await PGlite.create();
    server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
    await server.start();
    registry = await createPostgresWorkspaceRegistry(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { ssl: false, maxConnections: 1 });
  });
  afterAll(async () => {
    await registry.close();
    await server.stop();
    await db.close();
  });

  it('empieza vacía, guarda espacios y los lista del más antiguo al más nuevo', async () => {
    expect(await registry.list()).toEqual([]);
    await registry.create({ id: 'ws_socio_a1b2', name: 'Socio' });
    await registry.create({ id: 'ws_cliente_c3d4', name: 'Cliente' });
    expect((await registry.list()).map((w) => [w.id, w.name, w.igUserId])).toEqual([
      ['ws_socio_a1b2', 'Socio', null],
      ['ws_cliente_c3d4', 'Cliente', null],
    ]);
  });

  it('apunta la cuenta de Instagram del espacio y la encuentra por su id (para repartir los avisos)', async () => {
    await registry.setInstagram('ws_socio_a1b2', '1784140000000099', 'socio_ig');
    expect(await registry.findByIgUser('1784140000000099')).toMatchObject({ id: 'ws_socio_a1b2', igUsername: 'socio_ig' });
    expect(await registry.findByIgUser('no-existe')).toBeNull();
    // Una cuenta de Instagram solo puede estar en un espacio.
    await expect(registry.setInstagram('ws_cliente_c3d4', '1784140000000099', 'socio_ig')).rejects.toThrow();
  });

  it('borrar un espacio lo quita de la lista y recuerda su cuenta de Instagram como quitada (sus avisos se descartan)', async () => {
    await registry.remove('ws_socio_a1b2');
    expect((await registry.list()).map((w) => w.id)).toEqual(['ws_cliente_c3d4']);
    expect(await registry.findByIgUser('1784140000000099')).toBeNull();
    expect(await registry.removedIgUsers()).toEqual(['1784140000000099']);
    // Si esa cuenta se conecta después a otro espacio, deja de estar quitada.
    await registry.setInstagram('ws_cliente_c3d4', '1784140000000099', 'socio_ig');
    expect(await registry.removedIgUsers()).toEqual([]);
    // Borrar uno sin Instagram no apunta nada.
    await registry.create({ id: 'ws_vacio_e5f6', name: 'Vacío' });
    await registry.remove('ws_vacio_e5f6');
    expect(await registry.removedIgUsers()).toEqual([]);
  });
});

describe('crear la base de datos', () => {
  it('lanza el CREATE DATABASE con el id comprobado', async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const { provisionDatabase } = await import('../src/workspaces.js');
    await provisionDatabase({ unsafe }, 'ws_socio_a1b2');
    expect(unsafe).toHaveBeenCalledWith('CREATE DATABASE "ws_socio_a1b2"');
  });

  it('borrar la base solo acepta ids de espacio (nunca la principal) y cierra antes sus conexiones', async () => {
    expect(dropDatabaseSql('ws_socio_a1b2')).toBe('DROP DATABASE IF EXISTS "ws_socio_a1b2" WITH (FORCE)');
    expect(() => dropDatabaseSql('neondb')).toThrow();
    expect(() => dropDatabaseSql('ws_x"; DROP DATABASE neondb; --')).toThrow();
    const unsafe = vi.fn().mockResolvedValue([]);
    const { dropDatabase } = await import('../src/workspaces.js');
    await dropDatabase({ unsafe }, 'ws_socio_a1b2');
    expect(unsafe).toHaveBeenCalledWith('DROP DATABASE IF EXISTS "ws_socio_a1b2" WITH (FORCE)');
  });
});
