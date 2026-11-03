import HolderLayout from '../../../app/(holder)/_layout';
import LoginRoute from '../../../app/login';
import { HOLDER_HOME, safeHolderDestination } from '@/lib/navigation/return-destination';
import { renderWithProviders } from '@/test/render';
import { testNavigation } from '@/test/setup';

describe('safeHolderDestination', () => {
  it.each([
    '/credentials',
    '/credentials/cred-123',
    '/objectives',
    '/objectives/new',
    '/objectives/obj_1',
    '/profile-shares',
    '/profile-shares/share-9/verification-policy'
  ])('acepta la ruta interna del titular %s', (path) => {
    expect(safeHolderDestination(path)).toBe(path);
  });

  it.each([
    undefined,
    '',
    'https://evil.example/credentials',
    '//evil.example',
    'scope://credentials',
    '/login',
    '/register',
    '/issuer',
    '/admin',
    '/credentials/../admin',
    '/credentials/a/b',
    '/objectives/new?x=1',
    '/' + 'a'.repeat(400)
  ])('rechaza %p', (value) => {
    expect(safeHolderDestination(value)).toBeNull();
  });

  it('toma solo el primer valor de un parámetro repetido', () => {
    expect(safeHolderDestination(['/objectives', '/admin'])).toBe('/objectives');
  });
});

describe('enlace profundo sin sesión', () => {
  it('el espacio del titular manda al login con el destino pedido', async () => {
    testNavigation.route.pathname = '/credentials/cred-123';
    await renderWithProviders(<HolderLayout />, { accessToken: null });

    expect(testNavigation.route.redirects.at(-1)).toEqual({
      pathname: '/login',
      params: { next: '/credentials/cred-123' }
    });
  });

  it('un destino no permitido manda al login sin parámetro', async () => {
    testNavigation.route.pathname = '/admin';
    await renderWithProviders(<HolderLayout />, { accessToken: null });

    expect(testNavigation.route.redirects.at(-1)).toBe('/login');
  });

  it('después de autenticar vuelve al destino permitido', async () => {
    testNavigation.route.searchParams = { next: '/objectives/obj-1' };
    await renderWithProviders(<LoginRoute />);

    expect(testNavigation.route.redirects.at(-1)).toBe('/objectives/obj-1');
  });

  it('con un destino inválido vuelve al Perfil', async () => {
    testNavigation.route.searchParams = { next: 'https://evil.example' };
    await renderWithProviders(<LoginRoute />);

    expect(testNavigation.route.redirects.at(-1)).toBe(HOLDER_HOME);
  });

  it('sin destino vuelve al Perfil', async () => {
    await renderWithProviders(<LoginRoute />);

    expect(testNavigation.route.redirects.at(-1)).toBe(HOLDER_HOME);
  });
});
