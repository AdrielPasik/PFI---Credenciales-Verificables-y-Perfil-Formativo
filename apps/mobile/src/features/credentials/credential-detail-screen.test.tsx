import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import { CredentialDetailScreen } from '@/features/credentials/credential-detail-screen';
import {
  credentialDetailPayload,
  credentialDetailTorturePayload,
  LONG_DID,
  LONG_HASH,
  LONG_TEXT_500
} from '@/test/fixtures';
import type { StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const DETAIL_ROUTE = 'GET /me/credentials/cred-001';

async function renderDetail(
  detail: StubResponse = { body: credentialDetailPayload() }
) {
  return renderWithProviders(
    <CredentialDetailScreen credentialReference="cred-001" />,
    { routes: { [DETAIL_ROUTE]: detail } }
  );
}

describe('detalle de credencial', () => {
  it('presenta la credencial como protagonista, no la blockchain ni la IA', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Sistemas Operativos')).toBeTruthy()
    );

    expect(screen.getByText('Credencial formativa')).toBeTruthy();
    expect(
      screen.getByText('Emitida por Universidad Nacional Ejemplo.')
    ).toBeTruthy();
  });

  it('muestra la identidad humana canónica del titular y su correo como dato secundario', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Identidad de la credencial')).toBeTruthy()
    );

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('titular@example.com')).toBeTruthy();
    expect(screen.getByText(LONG_DID)).toBeTruthy();
  });

  it('no duplica el correo para un titular legacy cuyo displayLabel cae al email', async () => {
    const email = 'legacy.holder@example.com';

    await renderDetail({
      body: credentialDetailPayload({
        subject: { did: null, email, displayName: null, displayLabel: email }
      })
    });

    await waitFor(() => expect(screen.getByText(email)).toBeTruthy());
    expect(screen.getAllByText(email)).toHaveLength(1);
  });

  it('permite que un displayLabel largo del titular crezca sin truncarlo', async () => {
    const longDisplayLabel = `Gabriel ${'Pacífico '.repeat(14).trim()}`;

    await renderDetail({
      body: credentialDetailPayload({
        subject: {
          did: null,
          email: 'gabriel@example.com',
          displayName: null,
          displayLabel: longDisplayLabel
        }
      })
    });

    await waitFor(() => expect(screen.getByText(longDisplayLabel)).toBeTruthy());
    expect(screen.getByText(longDisplayLabel).props.numberOfLines).toBeUndefined();
  });

  it('muestra el aporte formativo declarado por la institución', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Aporte formativo')).toBeTruthy()
    );

    expect(screen.getByText('Licenciatura en Sistemas')).toBeTruthy();
    expect(screen.getByText('2025 - 2do cuatrimestre')).toBeTruthy();
    expect(screen.getByText('96 horas')).toBeTruthy();
  });

  it('renderiza competencias de 500 caracteres completas y multilínea', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByTestId('credential-declared-competencies')).toBeTruthy()
    );

    const entries = screen.getAllByText(LONG_TEXT_500);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.props.numberOfLines).toBeUndefined();
  });

  it('mantiene el lenguaje epistemológico de la interpretación asistida', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Interpretación asistida por IA')).toBeTruthy()
    );

    expect(
      screen.getByText(
        'Organiza información detectada en la evidencia. No modifica ni reemplaza los datos emitidos por la institución.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/certificado por (la )?ia/i)).toBeNull();
    expect(screen.queryByText(/verificado por (la )?ia/i)).toBeNull();
  });

  it('muestra el análisis parcial como parcial, con su confianza real', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText(/Análisis parcial/)).toBeTruthy()
    );

    expect(
      screen.getByText('Confianza del análisis: 62% de confianza.')
    ).toBeTruthy();
    expect(
      screen.getByText('Observaciones: evidencia limitada.')
    ).toBeTruthy();
  });

  it('explica la ausencia de análisis en vez de ocultar la sección', async () => {
    await renderDetail({
      body: credentialDetailPayload({ latestSemanticAnalysis: null })
    });

    await waitFor(() =>
      expect(
        screen.getByText('No hay análisis disponible para esta credencial.')
      ).toBeTruthy()
    );
  });

  it('muestra la evidencia documental y textual disponible', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Fuentes de respaldo')).toBeTruthy()
    );

    expect(
      screen.getByText('programa-sistemas-operativos.pdf')
    ).toBeTruthy();
    expect(screen.getByText('Programa de la asignatura')).toBeTruthy();
  });

  it('explica la evidencia ausente sin inventar contenido', async () => {
    await renderDetail({ body: credentialDetailTorturePayload() });

    await waitFor(() =>
      expect(
        screen.getByText(
          'No hay evidencia documental disponible para mostrar.'
        )
      ).toBeTruthy()
    );
    expect(
      screen.getByText('No hay evidencia textual disponible para mostrar.')
    ).toBeTruthy();
  });

  it('la integridad es secundaria: viene plegada por defecto', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Evidencia de integridad')).toBeTruthy()
    );

    expect(screen.queryByText(LONG_HASH)).toBeNull();

    await fireEvent.press(
      screen.getByText('Registro técnico de la credencial emitida')
    );

    await waitFor(() =>
      expect(screen.getAllByText(LONG_HASH).length).toBeGreaterThan(0)
    );
    expect(screen.getByText('canon_v1')).toBeTruthy();
    expect(screen.getByText('Red de prueba Sepolia')).toBeTruthy();
  });

  it('permite copiar un valor técnico largo y confirma la acción', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(
        screen.getByText('Registro técnico de la credencial emitida')
      ).toBeTruthy()
    );
    await fireEvent.press(
      screen.getByText('Registro técnico de la credencial emitida')
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Copiar Huella canónica')).toBeTruthy()
    );
    await fireEvent.press(screen.getByLabelText('Copiar Huella canónica'));

    await waitFor(() =>
      expect(screen.getByText('Huella canónica copiada.')).toBeTruthy()
    );
  });

  it('explica cuando no hay evidencia técnica, sin fabricar una', async () => {
    await renderDetail({
      body: credentialDetailPayload({
        canonicalHash: null,
        canonicalizationVersion: null,
        blockchainRecords: []
      })
    });

    await waitFor(() =>
      expect(
        screen.getByText('Registro técnico de la credencial emitida')
      ).toBeTruthy()
    );
    await fireEvent.press(
      screen.getByText('Registro técnico de la credencial emitida')
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          'La credencial fue emitida, pero no hay evidencia técnica disponible para mostrar.'
        )
      ).toBeTruthy()
    );
  });

  it('comunica una credencial revocada sin ocultar su contenido', async () => {
    await renderDetail({
      body: credentialDetailPayload({
        status: 'revoked',
        revokedAt: '2026-05-01T10:00:00.000Z',
        revocationReason: 'Error administrativo en la carga.'
      })
    });

    await waitFor(() =>
      expect(screen.getByText('Esta credencial está revocada')).toBeTruthy()
    );

    expect(
      screen.getByText('Error administrativo en la carga.')
    ).toBeTruthy();
    // El contenido formativo sigue visible.
    expect(screen.getByText('Aporte formativo')).toBeTruthy();
    expect(screen.getAllByText(LONG_TEXT_500).length).toBeGreaterThan(0);
  });

  it('muestra los datos declarados de un curso, incluida la URL externa', async () => {
    await renderDetail({ body: credentialDetailTorturePayload() });

    await waitFor(() =>
      expect(
        screen.getByText('Información declarada del curso')
      ).toBeTruthy()
    );

    expect(screen.getByText('Plataforma Ejemplo')).toBeTruthy();
    expect(screen.getByText('Virtual')).toBeTruthy();
    expect(
      screen.getByText('https://cursos.example.org/redes')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Enlace declarado por la institución emisora. No implica verificación oficial externa.'
      )
    ).toBeTruthy();
  });

  it('abre la URL declarada en el navegador del sistema', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await renderDetail({ body: credentialDetailTorturePayload() });

    await waitFor(() =>
      expect(
        screen.getByLabelText('Abrir https://cursos.example.org/redes')
      ).toBeTruthy()
    );
    await fireEvent.press(
      screen.getByLabelText('Abrir https://cursos.example.org/redes')
    );

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://cursos.example.org/redes')
    );

    openSpy.mockRestore();
  });
});

describe('errores del detalle', () => {
  it('distingue no encontrada de un problema de red', async () => {
    await renderDetail({ status: 404 });

    await waitFor(() =>
      expect(
        screen.getByText('No pudimos mostrar la credencial')
      ).toBeTruthy()
    );
    expect(
      screen.getByText('No encontramos esta credencial en tu espacio personal.')
    ).toBeTruthy();
    expect(screen.queryByText('Reintentar')).toBeNull();
  });

  it('distingue falta de permiso de no encontrada', async () => {
    await renderDetail({ status: 403 });

    await waitFor(() =>
      expect(
        screen.getByText('No tenés acceso a esta información')
      ).toBeTruthy()
    );
  });

  it('un problema de servicio sí ofrece reintentar', async () => {
    await renderDetail({ status: 500 });

    await waitFor(() => expect(screen.getByText('Reintentar')).toBeTruthy());
  });
});

describe('compartir credencial', () => {
  it('comparte el enlace público de verificación con el share sheet nativo', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Compartir credencial')).toBeTruthy()
    );
    await fireEvent.press(screen.getByText('Compartir credencial'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    const [payload] = shareSpy.mock.calls[0] as [
      { url?: string; message?: string }
    ];
    expect(payload.url).toBe(
      'https://scope.test/verify?credential=cred-001'
    );
    expect(payload.message).toContain('Sistemas Operativos');

    shareSpy.mockRestore();
  });

  it('no llama a ningún endpoint para compartir una credencial', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    const { calls } = await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Compartir credencial')).toBeTruthy()
    );
    const before = calls.length;
    await fireEvent.press(screen.getByText('Compartir credencial'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    expect(calls.length).toBe(before);

    shareSpy.mockRestore();
  });

  it('copia el enlace y confirma la acción', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Copiar enlace')).toBeTruthy()
    );
    await fireEvent.press(screen.getByText('Copiar enlace'));

    await waitFor(() =>
      expect(screen.getByText('Enlace copiado.')).toBeTruthy()
    );
  });

  it('abre la vista pública en el navegador, nunca dentro de la app', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Ver vista pública')).toBeTruthy()
    );
    await fireEvent.press(screen.getByText('Ver vista pública'));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://scope.test/verify?credential=cred-001'
      )
    );

    openSpy.mockRestore();
  });
});
