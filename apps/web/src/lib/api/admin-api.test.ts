import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  getAdminIssuerMembershipsRequest,
  getAdminIssuersRequest,
  grantAdminMembershipRequest,
  provisionAdminIssuerRequest,
  resolveAdminUserRequest
} from '@/lib/api/admin-api';
import * as adminApi from '@/lib/api/admin-api';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

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

// ---------------------------------------------------------------------------
// S6b -- MUTACIONES
// ---------------------------------------------------------------------------

const resolvedUserResponse = {
  email: 'persona@dominio.com',
  displayLabel: 'Ana Gómez'
};

const grantResponse = {
  issuer: { id: 'issuer-uade', name: 'UADE' },
  membership: {
    userId: 'user-ana',
    email: 'persona@dominio.com',
    displayLabel: 'Ana Gómez',
    role: 'admin',
    status: 'active',
    createdAt: '2026-10-05T10:00:00.000Z'
  }
};

const provisionResponse = {
  issuer: {
    id: 'issuer-nuevo',
    name: 'Universidad X',
    legalName: 'Universidad X',
    authorizationStatus: 'authorized',
    technicalIdentity: {
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false
    },
    createdAt: '2026-10-05T10:00:00.000Z'
  },
  initialAdminMembership: {
    userId: 'user-ana',
    email: 'persona@dominio.com',
    displayLabel: 'Ana Gómez',
    role: 'admin',
    status: 'active',
    createdAt: '2026-10-05T10:00:00.000Z'
  }
};

describe('admin-api: resolve user (S4)', () => {
  it('1-2: POST /admin/users/resolve con body exacto { email }', async () => {
    const request = vi.fn().mockResolvedValue(resolvedUserResponse);

    await resolveAdminUserRequest(request, 'persona@dominio.com');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/admin/users/resolve');
    expect(request.mock.calls[0][1].method).toBe('POST');
    expect(request.mock.calls[0][1].body).toEqual({
      email: 'persona@dominio.com'
    });
    // Exactamente una clave: nada mas cruza al servicio.
    expect(Object.keys(request.mock.calls[0][1].body)).toEqual(['email']);
  });

  it('8: la respuesta pasa por el adapter', async () => {
    const request = vi.fn().mockResolvedValue(resolvedUserResponse);

    const resolved = await resolveAdminUserRequest(request, 'x@y.co');

    expect(resolved).toEqual({
      email: 'persona@dominio.com',
      displayLabel: 'Ana Gómez'
    });
  });

  it('10: propaga el AbortSignal -- un resolve abandonado es seguro', async () => {
    const request = vi.fn().mockResolvedValue(resolvedUserResponse);
    const controller = new AbortController();

    await resolveAdminUserRequest(request, 'x@y.co', {
      signal: controller.signal
    });

    expect(request.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('9: un payload incompatible falla', async () => {
    for (const payload of [
      null,
      {},
      { email: 'x@y.co' },
      { displayLabel: 'Ana' }
    ]) {
      const request = vi.fn().mockResolvedValue(payload);
      await expect(resolveAdminUserRequest(request, 'x@y.co')).rejects.toThrow(
        IncompatiblePayloadError
      );
    }
  });
});

describe('admin-api: grant membership (S5a)', () => {
  it('3-5: POST a la ruta del issuer con body exacto { userEmail }', async () => {
    const request = vi.fn().mockResolvedValue(grantResponse);

    await grantAdminMembershipRequest(
      request,
      'issuer-uade',
      'persona@dominio.com'
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(
      '/admin/issuers/issuer-uade/memberships'
    );
    expect(request.mock.calls[0][1].method).toBe('POST');
    expect(request.mock.calls[0][1].body).toEqual({
      userEmail: 'persona@dominio.com'
    });
    expect(Object.keys(request.mock.calls[0][1].body)).toEqual(['userEmail']);
  });

  it('4: el issuerId va codificado en la URL', async () => {
    const request = vi.fn().mockResolvedValue(grantResponse);

    await grantAdminMembershipRequest(request, 'issuer/../otro', 'x@y.co');

    expect(request.mock.calls[0][0]).toBe(
      '/admin/issuers/issuer%2F..%2Fotro/memberships'
    );
  });

  it('una referencia vacía no llega al servicio', async () => {
    const request = vi.fn();

    await expect(
      grantAdminMembershipRequest(request, '  ', 'x@y.co')
    ).rejects.toThrow('La referencia de institución no es válida.');
    expect(request).not.toHaveBeenCalled();
  });

  it('8: la respuesta pasa por el adapter y conserva email nullable', async () => {
    const request = vi.fn().mockResolvedValue({
      ...grantResponse,
      membership: { ...grantResponse.membership, email: null }
    });

    const result = await grantAdminMembershipRequest(
      request,
      'issuer-uade',
      'x@y.co'
    );

    expect(result.issuer).toEqual({
      issuerReference: 'issuer-uade',
      name: 'UADE'
    });
    expect(result.membership.email).toBeNull();
    expect(result.membership.role).toBe('admin');
    expect(result.membership.status).toBe('active');
  });

  it('9: un payload incompatible falla', async () => {
    for (const payload of [
      null,
      {},
      { issuer: { id: 'x', name: 'y' } },
      { membership: grantResponse.membership },
      {
        ...grantResponse,
        membership: { ...grantResponse.membership, role: 'root' }
      }
    ]) {
      const request = vi.fn().mockResolvedValue(payload);
      await expect(
        grantAdminMembershipRequest(request, 'issuer-uade', 'x@y.co')
      ).rejects.toThrow(IncompatiblePayloadError);
    }
  });

  it('10: NO acepta AbortSignal -- abortar un POST deja el resultado ambiguo', () => {
    // Decision deliberada: cancelar una mutacion no la cancela en el servidor,
    // solo deja al cliente sin saber si ocurrio.
    expect(grantAdminMembershipRequest.length).toBe(3);
  });
});

describe('admin-api: provision issuer (S5b)', () => {
  it('6-7: POST /admin/issuers con los tres campos exactos', async () => {
    const request = vi.fn().mockResolvedValue(provisionResponse);

    await provisionAdminIssuerRequest(request, {
      name: 'Universidad X',
      legalName: 'Universidad X S.A.',
      initialAdminUserEmail: 'persona@dominio.com'
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/admin/issuers');
    expect(request.mock.calls[0][1].method).toBe('POST');
    expect(request.mock.calls[0][1].body).toEqual({
      name: 'Universidad X',
      legalName: 'Universidad X S.A.',
      initialAdminUserEmail: 'persona@dominio.com'
    });
    expect(Object.keys(request.mock.calls[0][1].body).sort()).toEqual([
      'initialAdminUserEmail',
      'legalName',
      'name'
    ]);
  });

  it('7: ningún campo extra cruza aunque se lo pasen al comando', async () => {
    const request = vi.fn().mockResolvedValue(provisionResponse);

    await provisionAdminIssuerRequest(request, {
      name: 'Universidad X',
      legalName: 'Universidad X',
      initialAdminUserEmail: 'persona@dominio.com',
      // Campos de autoridad / identidad tecnica que NUNCA pueden viajar.
      authorizationStatus: 'authorized',
      authorizedAt: '2026-10-05',
      role: 'admin',
      status: 'active',
      did: 'did:example:falso',
      walletAddress: '0xdeadbeef',
      privateKey: 'NUNCA',
      metadata: { x: 1 }
    } as never);

    expect(Object.keys(request.mock.calls[0][1].body).sort()).toEqual([
      'initialAdminUserEmail',
      'legalName',
      'name'
    ]);
    const serialized = JSON.stringify(request.mock.calls[0][1].body);
    for (const leak of [
      'authorizationStatus',
      'authorizedAt',
      'role',
      'status',
      'did',
      'walletAddress',
      'privateKey',
      'metadata'
    ]) {
      expect(serialized, `no debe viajar ${leak}`).not.toContain(leak);
    }
  });

  it('8: la respuesta pasa por el adapter', async () => {
    const request = vi.fn().mockResolvedValue(provisionResponse);

    const result = await provisionAdminIssuerRequest(request, {
      name: 'Universidad X',
      legalName: 'Universidad X',
      initialAdminUserEmail: 'persona@dominio.com'
    });

    expect(result.issuer.issuerReference).toBe('issuer-nuevo');
    expect(result.issuer.authorizationLabel).toBe('Habilitada');
    expect(result.issuer.technicalIdentity).toEqual({
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false,
      readinessLabel: 'Pendiente'
    });
    expect(result.initialAdminMembership.role).toBe('admin');
  });

  it('9: un payload incompatible falla', async () => {
    for (const payload of [
      null,
      {},
      { issuer: provisionResponse.issuer },
      {
        ...provisionResponse,
        issuer: { ...provisionResponse.issuer, authorizationStatus: 'verified' }
      }
    ]) {
      const request = vi.fn().mockResolvedValue(payload);
      await expect(
        provisionAdminIssuerRequest(request, {
          name: 'x',
          legalName: 'y',
          initialAdminUserEmail: 'z@w.co'
        })
      ).rejects.toThrow(IncompatiblePayloadError);
    }
  });

  it('10: NO acepta AbortSignal -- este POST ademas NO es idempotente', () => {
    expect(provisionAdminIssuerRequest.length).toBe(2);
  });
});

/**
 * GUARD DE LA SUPERFICIE ADMINISTRATIVA -- S6a, TRANSFORMADO EN S6b.
 *
 * En S6a este guard afirmaba "read-only". Ese contrato cambio
 * DELIBERADAMENTE: /admin ahora muta. Pero el guard no se borro -- se
 * convirtio en lo que corresponde, que es mas fuerte que "no mutes":
 *
 *     la superficie administrativa del frontend es una MUTATION SURFACE
 *     EXPLICITAMENTE ALLOWLISTED
 *
 * Permitido, y nada mas:
 *
 *   GET   /admin/issuers
 *   GET   /admin/issuers/:issuerId/memberships
 *   POST  /admin/users/resolve
 *   POST  /admin/issuers/:issuerId/memberships
 *   POST  /admin/issuers
 *
 * Prohibido: PUT, PATCH, DELETE, y cualquier otro path bajo /admin. Agregar
 * uno tiene que ser un acto consciente y visible en el diff, con su propio
 * slice -- no un efecto colateral de una feature de UI.
 *
 * Se comprueba por dos vias complementarias: por el MODULO (exports exactos, y
 * metodo/URL/body verificados arriba con dobles del transporte) y por el
 * CODIGO de la feature (grep sobre el codigo sin comentarios; los comentarios
 * se quitan porque NOMBRAN endpoints y claves prohibidas para explicar por que
 * lo estan, y eso no debe hacer fallar el guard).
 */
describe('admin-api: superficie administrativa allowlisted (guard)', () => {
  const adminFeatureFiles = [
    '../api/admin-api.ts',
    '../../features/admin/admin-route.tsx',
    '../../features/admin/admin-route-boundary.tsx',
    '../../features/admin/admin-issuers-view.tsx',
    '../../features/admin/admin-add-member-flow.tsx',
    '../../features/admin/admin-create-issuer-flow.tsx',
    '../adapters/platform-admin.adapter.ts'
  ];

  /** El codigo de un archivo del slice, SIN comentarios. */
  function executableCode(relativePath: string): string {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
  }

  it('13: el módulo expone exactamente 2 lecturas + 3 mutaciones', () => {
    expect(Object.keys(adminApi).sort()).toEqual([
      'getAdminIssuerMembershipsRequest',
      'getAdminIssuersRequest',
      'grantAdminMembershipRequest',
      'provisionAdminIssuerRequest',
      'resolveAdminUserRequest'
    ]);
  });

  it('13: los únicos paths /admin del frontend son los cinco allowlisted', () => {
    // Se extraen TODOS los literales que empiezan con `/admin` en todo el
    // slice. Un sexto path aparece en el diff en vez de pasar inadvertido.
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
      // El template literal del grant/GET por issuer, tal cual en el codigo.
      '/admin/issuers/${encodeURIComponent(reference)}/memberships',
      '/admin/users/resolve'
    ]);
  });

  it('13: SOLO admin-api.ts habla con el backend', () => {
    // Los flujos y la vista no construyen rutas ni metodos: el unico lugar con
    // conocimiento del transporte es el modulo del cliente.
    const soloApi = adminFeatureFiles.filter(
      (file) => file !== '../api/admin-api.ts'
    );

    for (const file of soloApi) {
      const code = executableCode(file);
      expect(code, `${file} no debe construir rutas /admin`).not.toMatch(
        /['"`]\/admin/
      );
      expect(code, `${file} no debe declarar metodos HTTP`).not.toMatch(
        /method:\s*['"]/
      );
    }
  });

  it('13: ningún archivo de /admin emite PUT, PATCH ni DELETE', () => {
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        expect(
          code,
          `${file} no debe emitir ${method}`
        ).not.toContain(`method: '${method}'`);
        expect(code, `${file} no debe emitir ${method}`).not.toContain(
          `method: "${method}"`
        );
      }
    }

    // El POST si existe, pero SOLO en el cliente, y exactamente tres veces.
    const apiCode = executableCode('../api/admin-api.ts');
    expect(apiCode.match(/method: 'POST'/g)).toHaveLength(3);
  });

  it('11-12: ningún archivo de /admin hace fetch directo ni toca el token', () => {
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

  it('seguridad: ningún campo de identidad técnica ni secreto en toda la superficie', () => {
    // S6b no implementa provisioning tecnico. Ni un input, ni un campo de
    // estado, ni una clave de body: la configuracion de DID/wallet sera un
    // slice aparte con su propio contrato de seguridad.
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      for (const forbidden of [
        'privateKey',
        'signingKey',
        'mnemonic',
        'seedPhrase',
        'rpcUrl',
        'chainId',
        'contractAddress',
        'blockchainNetwork',
        'issuerAddress'
      ]) {
        expect(code, `${file} no debe mencionar ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });

  it('seguridad: ningún formulario administrativo se persiste en el navegador', () => {
    // El objetivo de un grant no tiene por que sobrevivir a la pestana.
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      for (const forbidden of [
        'localStorage',
        'sessionStorage',
        'document.cookie'
      ]) {
        expect(code, `${file} no debe usar ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });

  it('seguridad: no se loggea información administrativa', () => {
    for (const file of adminFeatureFiles) {
      const code = executableCode(file);

      expect(code, `${file} no debe loggear`).not.toMatch(/console\.\w+\(/);
    }
  });

  it('1-5: el cliente nunca CONSTRUYE userId, role, status ni authorizationStatus', () => {
    // `admin-api.ts` es el unico archivo que arma bodies, asi que es el unico
    // donde una clave de autoridad podria colarse a la red. Los bodies ya se
    // verificaron campo por campo arriba; esto congela que ni siquiera
    // aparezcan como claves.
    const code = executableCode('../api/admin-api.ts');

    for (const forbidden of [
      'userId:',
      'role:',
      'status:',
      'authorizationStatus:',
      'authorizedAt:',
      'membershipRole',
      'membershipStatus',
      'onboardingIntent',
      'isPlatformAdmin'
    ]) {
      expect(code, `admin-api no debe construir ${forbidden}`).not.toContain(
        forbidden
      );
    }
  });

  it('1-6: los flujos no conocen ningún identificador de autoridad', () => {
    // Los flujos operan POR EMAIL. No se chequea `status:`/`role:` aca porque
    // son discriminantes legitimos de sus propias maquinas de estado locales
    // (`{ status: 'confirm' }`) -- lo que se congela es que no exista ningun
    // identificador ni campo de autoridad del dominio, que es lo que podria
    // terminar viajando.
    const flowFiles = [
      '../../features/admin/admin-add-member-flow.tsx',
      '../../features/admin/admin-create-issuer-flow.tsx'
    ];

    for (const file of flowFiles) {
      const code = executableCode(file);

      for (const forbidden of [
        'userId',
        'authorizationStatus',
        'authorizedAt',
        'membershipRole',
        'membershipStatus',
        'onboardingIntent',
        'isPlatformAdmin',
        'platformAdmin'
      ]) {
        expect(code, `${file} no debe mencionar ${forbidden}`).not.toContain(
          forbidden
        );
      }

      // Y si mandan el email que DEVOLVIO el backend, no el del input.
      expect(code).toContain('resolved.email');
    }
  });
});
