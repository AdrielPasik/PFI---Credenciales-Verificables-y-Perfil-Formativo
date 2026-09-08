import { screen, waitFor } from '@testing-library/react-native';

import { CredentialsScreen } from '@/features/credentials/credentials-screen';
import { credentialListPayload } from '@/test/fixtures';
import type { StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const CREDENTIALS_ROUTE = 'GET /me/credentials';

async function renderCredentials(
  credentials: StubResponse = { body: credentialListPayload() }
) {
  return renderWithProviders(<CredentialsScreen />, {
    routes: { [CREDENTIALS_ROUTE]: credentials }
  });
}

describe('biblioteca de credenciales', () => {
  it('lista las credenciales del titular con su estado', async () => {
    await renderCredentials();

    await waitFor(() =>
      expect(screen.getByText('Sistemas Operativos')).toBeTruthy()
    );

    expect(screen.getByText('Mis credenciales')).toBeTruthy();
    expect(screen.getByText('Introducción a Redes')).toBeTruthy();
    expect(screen.getByText('Certificación en Ciberseguridad')).toBeTruthy();
    expect(screen.getByText('Licenciatura en Sistemas')).toBeTruthy();
  });

  it('muestra los cuatro tipos de credencial, no sólo cursos', async () => {
    await renderCredentials();

    await waitFor(() =>
      expect(screen.getByText('Asignatura académica')).toBeTruthy()
    );

    expect(screen.getByText('Curso')).toBeTruthy();
    expect(screen.getByText('Certificación')).toBeTruthy();
    expect(screen.getByText('Título académico')).toBeTruthy();
  });

  it('comunica el estado con texto, no sólo con color', async () => {
    await renderCredentials();

    await waitFor(() => expect(screen.getAllByText('Emitida').length).toBe(3));
    expect(screen.getByText('Revocada')).toBeTruthy();
  });

  it('una credencial revocada sigue siendo legible y navegable', async () => {
    await renderCredentials();

    await waitFor(() =>
      expect(screen.getByText('Introducción a Redes')).toBeTruthy()
    );

    const card = screen.getByTestId('credential-card-cred-002');
    expect(card.props.accessibilityLabel).toContain('Introducción a Redes');
    expect(card.props.accessibilityLabel).toContain('Revocada');
    expect(card.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('la tarjeta completa es el objetivo táctil y describe la credencial', async () => {
    await renderCredentials();

    await waitFor(() =>
      expect(screen.getByTestId('credential-card-cred-001')).toBeTruthy()
    );

    const card = screen.getByTestId('credential-card-cred-001');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain('Sistemas Operativos');
    expect(card.props.accessibilityLabel).toContain(
      'Emitida por Universidad Nacional Ejemplo'
    );
    expect(card.props.accessibilityHint).toBe(
      'Abre el detalle de la credencial'
    );
  });

  it('muestra el estado vacío sin acciones propias de un emisor', async () => {
    await renderCredentials({ body: [] });

    await waitFor(() =>
      expect(
        screen.getByText('Todavía no tenés credenciales formativas')
      ).toBeTruthy()
    );

    expect(screen.queryByText(/crear credencial/i)).toBeNull();
    expect(screen.queryByText(/emitir/i)).toBeNull();
    expect(screen.queryByText(/pr[oó]ximamente/i)).toBeNull();
  });

  it('distingue un fallo de servicio de una lista vacía', async () => {
    await renderCredentials({ status: 500 });

    await waitFor(() =>
      expect(
        screen.getByText('Scope no está disponible en este momento')
      ).toBeTruthy()
    );

    expect(
      screen.queryByText('Todavía no tenés credenciales formativas')
    ).toBeNull();
  });

  it('ofrece reintentar ante un error recuperable', async () => {
    await renderCredentials({ status: 500 });

    await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
  });

  it('no ofrece reintentar cuando reintentar no puede ayudar', async () => {
    await renderCredentials({ status: 404 });

    await waitFor(() =>
      expect(screen.getByText('No encontramos credenciales')).toBeTruthy()
    );
    expect(screen.queryByText('Reintentar')).toBeNull();
  });

  it('rechaza un payload incompatible con un mensaje propio', async () => {
    await renderCredentials({ body: [{ id: 'x' }] });

    await waitFor(() =>
      expect(
        screen.getByText('La información no tiene el formato esperado')
      ).toBeTruthy()
    );
  });
});
