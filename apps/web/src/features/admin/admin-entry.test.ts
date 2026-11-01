import { describe, expect, it } from 'vitest';

import {
  adminHrefFrom,
  adminReturnDestination,
  parseAdminEntry
} from '@/features/admin/admin-entry';

describe('origen de Administracion', () => {
  it('cada origen vuelve a una ruta fija con una etiqueta explicita', () => {
    expect(adminReturnDestination('wallet')).toEqual({
      href: '/wallet',
      label: 'Volver a mi espacio personal'
    });
    expect(adminReturnDestination('issuer')).toEqual({
      href: '/issuer',
      label: 'Volver al panel del emisor'
    });
    expect(adminReturnDestination('pending')).toEqual({
      href: '/institutional-access-pending',
      label: 'Volver a mi acceso institucional'
    });
  });

  it('sin origen no promete un "volver": ofrece ir al espacio personal', () => {
    expect(adminReturnDestination(null)).toEqual({
      href: '/wallet',
      label: 'Ir a mi espacio personal'
    });
  });

  it('solo acepta valores cerrados: nunca una URL ni otra ruta', () => {
    for (const raw of ['https://evil.example', '//evil.example', '/issuer', 'admin', '', undefined, ['wallet']]) {
      expect(parseAdminEntry(raw)).toBeNull();
    }
    expect(parseAdminEntry('issuer')).toBe('issuer');
  });

  it('el enlace a Administracion lleva el origen como enum', () => {
    expect(adminHrefFrom('issuer')).toBe('/admin?from=issuer');
  });
});
