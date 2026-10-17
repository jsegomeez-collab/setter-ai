import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerWebApp } from '../src/web.js';

/** El servidor sirve el frontend compilado (web/dist) en /app; cualquier ruta de la app devuelve index.html. */

function distWithFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Setter IA</title>');
  writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'app-123.css'), 'body{}');
  return dir;
}

function appWith(dir: string): Hono {
  const app = new Hono();
  registerWebApp(app, dir);
  return app;
}

describe('frontend en /app', () => {
  it('sirve index.html en /app y en cualquier ruta de la app (la navegación la hace React)', async () => {
    const app = appWith(distWithFiles());
    for (const path of ['/app', '/app/', '/app/setter', '/app/conversaciones/123']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('Setter IA');
    }
  });

  it('sirve los archivos compilados con su tipo y caché larga (llevan huella en el nombre)', async () => {
    const app = appWith(distWithFiles());
    const js = await app.request('/app/assets/app-123.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await js.text()).toBe('console.log(1)');
    expect((await app.request('/app/assets/app-123.css')).headers.get('content-type')).toContain('text/css');
    expect((await app.request('/app/assets/no-existe.js')).status).toBe(404);
  });

  it('no deja salir de la carpeta de la web (../)', async () => {
    const app = appWith(distWithFiles());
    for (const path of ['/app/../package.json', '/app/assets/..%2F..%2Fpackage.json', '/app/%2e%2e/%2e%2e/package.json']) {
      const res = await app.request(path);
      expect(await res.text(), path).not.toContain('"name"');
    }
  });

  it('cabeceras de seguridad: no se puede meter en otra web ni adivinar tipos; index.html sin caché', async () => {
    const app = appWith(distWithFiles());
    const res = await app.request('/app');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('si la web no está compilada lo dice claro (503) en vez de fallar', async () => {
    const app = appWith(join(tmpdir(), 'no-existe-esta-carpeta-web'));
    const res = await app.request('/app');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('npm run build');
  });
});
