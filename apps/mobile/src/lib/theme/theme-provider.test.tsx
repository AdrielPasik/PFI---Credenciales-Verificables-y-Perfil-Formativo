import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import { ScopeText } from '@/components/ui/text';
import { AppearanceSelector } from '@/features/auth/appearance-selector';
import {
  InMemoryAppearanceStorage,
  SecureAppearanceStorage
} from '@/lib/theme/appearance-storage';
import { resolveColorScheme, ThemeProvider, useTheme } from '@/lib/theme/theme-provider';
import { darkColors, lightColors } from '@/lib/theme/tokens';

// Apariencia del sistema controlable desde el test: emula el cambio de tema
// del teléfono mientras la app está abierta.
const mockSystem = {
  scheme: 'light' as 'light' | 'dark',
  listeners: new Set<() => void>()
};

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  function useMockColorScheme() {
    return useSyncExternalStore(
      (listener: () => void) => {
        mockSystem.listeners.add(listener);
        return () => mockSystem.listeners.delete(listener);
      },
      () => mockSystem.scheme
    );
  }
  return { __esModule: true, default: useMockColorScheme };
});

async function setSystemScheme(scheme: 'light' | 'dark') {
  await act(async () => {
    mockSystem.scheme = scheme;
    mockSystem.listeners.forEach((listener) => listener());
  });
}

function Probe() {
  const { scheme, preference, ready } = useTheme();
  return (
    <ScopeText testID="probe" tone="strong">
      {`${scheme}|${preference}|${ready ? 'listo' : 'cargando'}`}
    </ScopeText>
  );
}

async function renderTheme(storage = new InMemoryAppearanceStorage()) {
  await render(
    <ThemeProvider storage={storage}>
      <Probe />
      <AppearanceSelector />
    </ThemeProvider>
  );
  return storage;
}

function probe() {
  return screen.getByTestId('probe');
}

function probeColor() {
  const style = [probe().props.style].flat(Infinity) as { color?: string }[];
  return style.reduce<string | undefined>((color, s) => s?.color ?? color, undefined);
}

let setColorScheme: jest.SpyInstance;

beforeEach(() => {
  mockSystem.scheme = 'light';
  mockSystem.listeners.clear();
  setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
});

afterEach(() => {
  setColorScheme.mockRestore();
});

describe('resolveColorScheme', () => {
  it('una elección explícita gana sobre el sistema', () => {
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveColorScheme('light', 'dark')).toBe('light');
  });

  it('"sistema" sigue al dispositivo y cae a claro si no informa', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', 'unspecified')).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('sin preferencia guardada sigue al sistema', async () => {
    mockSystem.scheme = 'dark';
    await renderTheme();
    expect(probe()).toHaveTextContent('dark|system|listo');
    expect(probeColor()).toBe(darkColors.text.strong);
  });

  it('sigue los cambios de apariencia del sistema mientras la app está abierta', async () => {
    await renderTheme();
    expect(probe()).toHaveTextContent('light|system|listo');

    await setSystemScheme('dark');
    expect(probe()).toHaveTextContent('dark|system|listo');
    expect(probeColor()).toBe(darkColors.text.strong);

    await setSystemScheme('light');
    expect(probeColor()).toBe(lightColors.text.strong);
  });

  it('restaura la preferencia guardada antes de declararse listo', async () => {
    mockSystem.scheme = 'light';
    await renderTheme(new InMemoryAppearanceStorage('dark'));
    expect(probe()).toHaveTextContent('dark|dark|listo');
  });

  it('con una elección explícita ignora los cambios del sistema', async () => {
    await renderTheme(new InMemoryAppearanceStorage('light'));
    await setSystemScheme('dark');
    expect(probe()).toHaveTextContent('light|light|listo');
  });

  it('aplica la elección a los componentes nativos y libera el override con "sistema"', async () => {
    await renderTheme(new InMemoryAppearanceStorage('dark'));
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');

    await fireEvent.press(screen.getByTestId('appearance-system'));
    expect(setColorScheme).toHaveBeenLastCalledWith('unspecified');
  });
});

describe('AppearanceSelector', () => {
  it('ofrece sistema, claro y oscuro como opciones excluyentes', async () => {
    await renderTheme();
    expect(screen.getByLabelText('Apariencia').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Claro' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Oscuro' })).not.toBeChecked();
  });

  it('cambiar a oscuro repinta la app y persiste la elección', async () => {
    const storage = await renderTheme();

    await fireEvent.press(screen.getByRole('radio', { name: 'Oscuro' }));

    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
    expect(probe()).toHaveTextContent('dark|dark|listo');
    expect(probeColor()).toBe(darkColors.text.strong);
    await expect(storage.getPreference()).resolves.toBe('dark');
  });

  it('volver a "sistema" retoma la apariencia del dispositivo', async () => {
    mockSystem.scheme = 'dark';
    const storage = await renderTheme(new InMemoryAppearanceStorage('light'));
    expect(probe()).toHaveTextContent('light|light|listo');

    await fireEvent.press(screen.getByRole('radio', { name: 'Sistema' }));

    expect(probe()).toHaveTextContent('dark|system|listo');
    await expect(storage.getPreference()).resolves.toBe('system');
  });
});

describe('SecureAppearanceStorage', () => {
  it('guarda y lee la preferencia', async () => {
    const storage = new SecureAppearanceStorage();
    await storage.setPreference('dark');
    await expect(storage.getPreference()).resolves.toBe('dark');
  });

  it('un valor desconocido se trata como "sin preferencia"', async () => {
    const SecureStore = jest.requireMock('expo-secure-store') as {
      getItemAsync: jest.Mock;
    };
    SecureStore.getItemAsync.mockResolvedValueOnce('sepia');
    await expect(new SecureAppearanceStorage().getPreference()).resolves.toBeNull();
  });

  it('un fallo de lectura no rompe el arranque', async () => {
    const SecureStore = jest.requireMock('expo-secure-store') as {
      getItemAsync: jest.Mock;
    };
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore'));
    await expect(new SecureAppearanceStorage().getPreference()).resolves.toBeNull();
  });
});
