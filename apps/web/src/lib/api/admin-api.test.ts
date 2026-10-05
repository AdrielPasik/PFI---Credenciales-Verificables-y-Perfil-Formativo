import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  getAdminIssuerMembershipsRequest,
  getAdminIssuersRequest
} from '@/lib/api/admin-api';
import * as adminApi from '@/lib/api/admin-api';

const issuersResponse = {
  items: [
    {
      id: 'issuer-uade',
      name: 'UADE',
      legalName: 'UADE S.A.',
      authorizationStatus: 'authorized',
      technicalIdentity: {
        didConfigured: true,
        walletConfigured: true,
        readyToIssue: true
      },
      membershipCounts: { active: 1, total: 2 },
      catalogCounts: {
        academicCourses: 1,
        programs: 1,
        curriculumVersions: 1,
        programCourses: 1
      },
      createdAt: '2026-01-15T10:30:00.000Z'
    }
  ]
};

const membershipsResponse = {
  issuer: { id: 'issuer-uade', name: 'UADE' },
  items: [
    {
      userId: 'user-juan',
      email: 'juan@uade.edu.ar',
      displayLabel: 'Juan Pérez',
      role: 'admin',
      status: 'active',
      createdAt: '2026-02-01T09:00:00.000Z'
    }
  ]
};

describe('admin-api', () => {
  it('GET /admin/issuers: la ruta exacta, sin método ni body', async () => {
    const request = vi.fn().mockResolvedValue(issuersResponse);

    const list = await getAdminIssuersRequest(request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/admin/issuers');
    // Ningun `method`: el default de `ApiClient` es GET. Y ningun `body`.
    const options = request.mock.calls[0][1] ?? {};
    expect(options.method).toBeUndefined();
    expect(options.body).toBeUndefined();
    expect(list.items[0].issuerReference).toBe('issuer-uade');
  });

  it('GET memberships: la ruta exacta del issuer, sin método ni body', async () => {
    const request = vi.fn().mockResolvedValue(membershipsResponse);

    const response = await getAdminIssuerMembershipsRequest(
      request,
      'issuer-uade'
    );

    expect(request.mock.calls[0][0]).toBe(
      '/admin/issuers/issuer-uade/memberships'
    );
    const options = request.mock.calls[0][1] ?? {};
    expect(options.method).toBeUndefined();
    expect(options.body).toBeUndefined();
    expect(response.items[0].userReference).toBe('user-juan');
  });

  it('la referencia del issuer se codifica: nunca se interpola cruda en la URL', async () => {
    const request = vi.fn().mockResolvedValue(membershipsResponse);

    await getAdminIssuerMembershipsRequest(request, 'issuer/../../otro');

    expect(request.mock.calls[0][0]).toBe(
      '/admin/issuers/issuer%2F..%2F..%2Fotro/memberships'
    );
  });

  it('una referencia vacía no llega al servicio', async () => {
    const request = vi.fn();

    await expect(
      getAdminIssuerMembershipsRequest(request, '   ')
    ).rejects.toThrow('La referencia de institución no es válida.');
    expect(request).not.toHaveBeenCalled();
  });

  it('propaga el AbortSignal para poder abandonar una selección obsoleta', async () => {
    const request = vi.fn().mockResolvedValue(membershipsResponse);
    const controller = new AbortController();

    await getAdminIssuerMembershipsRequest(request, 'issuer-uade', {
      signal: controller.signal
    });

    expect(request.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('los errores del transporte se propagan sin envolverse', async () => {
    const failure = new Error('rechazado');
    const request = vi.fn().mockRejectedValue(failure);

    await expect(getAdminIssuersRequest(request)).rejects.toBe(failure);
    await expect(
      getAdminIssuerMembershipsRequest(request, 'issuer-uade')
    ).rejects.toBe(failure);
  });
});

/**
 * GUARD DE LECTURA PURA -- S6a.
 *
 * Congela que la superficie /admin del frontend consume EXCLUSIVAMENTE los dos
 * GET de S3, y que no invoca los tres endpoints mutantes que el backend ya
 * expone desde S4/S5a/S5b.
 *
 * Se comprueba de dos formas que se complementan:
 *
 *   1. por el MODULO: `admin-api.ts` exporta exactamente dos funciones, y
 *      ninguna emite un metodo distinto de GET (verificado arriba, con dobles
 *      del transporte);
 *   2. por el CODIGO de la feature: ningun archivo de `features/admin` ni
 *      `lib/api/admin-api.ts` menciona los paths mutantes ni un `method:
 *      'POST'` en codigo ejecutable.
 *
 * El (2) es un grep sobre el codigo sin comentarios, no un AST: alcanza y es
 * legible. Los comentarios se quitan a proposito, porque los de este slice
 * NOMBRAN los tres endpoints mutantes para explicar que pertenecen a S6b --
 * y eso no debe hacer fallar el guard.
 */
describe('admin-api: lectura pura (guard)', () => {
  const adminFeatureFiles = [
    '../api/admin-api.ts',
    '../../features/admin/admin-route.tsx',
    '../../features/admin/admin-route-boundary.tsx',
    '../../features/admin/admin-issuers-view.tsx',
    '../adapters/platform-admin.adapter.ts'
  ];

  /** El codigo de un archivo del slice, SIN comentarios. */
  function executableCode(relativePath: string): string {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
  }

  it('el módulo exporta exactamente las dos lecturas', () => {
    expect(Object.keys(adminApi).sort()).toEqual([
      'getAdminIssuerMembershipsRequest',
      'getAdminIssuersRequest'
    ]);
  });

  it('ningún archivo de /admin invoca POST /admin/users/resolve (S4)', () => {
    for (const file of adminFeatureFiles) {
      expect(
        executableCode(file),
        `${file} no debe resolver usuarios: eso es S6b`
      ).not.toContain('/admin/users/resolve');
    }
  });

  it('los únicos paths /admin del frontend son los dos de lectura', () => {
    // Se extraen TODOS los literales que empiezan con `/admin` en todo el
    // slice. Si manana aparece un tercero -- por ejemplo el POST de alta --
    // este test lo muestra en el diff en vez de dejarlo pasar.
    const paths = new Set<string>();

    for (const file of adminFeatureFiles) {
      for (const match of executableCode(file).matchAll(
        /['"`](\/admin[^'"`]*)['"`]/g
      )) {
        paths.add(match[1]);
      }
    }

    expect([...paths].sort()).toEqual([
      '/admin/issuers',
      // El template literal del GET por issuer, tal cual esta en el codigo.
      '/admin/issuers/${encodeURIComponent(reference)}/memberships'
    ]);
  });

  it('ningún archivo de /admin emite POST, PUT ni PATCH', () => {
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(
          code,
          `${file} no debe emitir ${method}`
        ).not.toContain(`method: '${method}'`);
        expect(code, `${file} no debe emitir ${method}`).not.toContain(
          `method: "${method}"`
        );
      }
    }
  });

  it('ningún archivo de /admin hace fetch directo ni toca el token', () => {
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      expect(code, `${file} no debe usar fetch directo`).not.toMatch(
        /\bfetch\s*\(/
      );
      expect(code, `${file} no debe leer el token`).not.toContain(
        'getAccessToken'
      );
      // Literal de string exacto: `IssuerAuthorizationStatus` es un NOMBRE DE
      // TIPO del dominio y no tiene nada que ver con el header HTTP.
      expect(
        code,
        `${file} no debe armar el header Authorization`
      ).not.toMatch(/['"]Authorization['"]/);
    }
  });

  it('la vista de /admin no declara ningún formulario ni acción de alta', () => {
    const viewCode = executableCode('../../features/admin/admin-issuers-view.tsx');

    expect(viewCode).not.toContain('<form');
    expect(viewCode).not.toContain('onSubmit');
    expect(viewCode).not.toContain('disabled');
    // Tampoco el copy de las acciones que llegan en S6b.
    for (const copy of [
      'Crear institución',
      'Agregar admin',
      'Asignar usuario',
      'Próximamente'
    ]) {
      expect(viewCode, `no debe anticipar "${copy}"`).not.toContain(copy);
    }
  });
});
