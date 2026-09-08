/**
 * Preparación del entorno de test.
 *
 * Se simulan sólo los módulos nativos que el preset de `jest-expo` no cubre y
 * que la app usa de verdad. Nada acá toca la red: cada test que necesita HTTP
 * inyecta su propio `fetch` falso en `HttpClient`.
 */

// React Testing Library ejecuta el renderer en modo `act`. El preset de
// jest-expo no declara esta bandera global, y sin ella React advierte en
// cada actualización de estado.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSecureStoreValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreValues.delete(key);
  })
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true)
}));

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: jest.fn(async () => undefined)
}));

jest.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true, null],
  Inter_400Regular: 'Inter_400Regular',
  Inter_500Medium: 'Inter_500Medium',
  Inter_600SemiBold: 'Inter_600SemiBold',
  Inter_700Bold: 'Inter_700Bold'
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn()
  }),
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
  Link: () => null
}));

export function resetSecureStore() {
  mockSecureStoreValues.clear();
}

beforeEach(() => {
  resetSecureStore();
});

// Un warning de React (por ejemplo, una actualización de estado fuera de
// `act`) indica un test mal escrito: se convierte en fallo en vez de quedar
// enterrado en la salida.
const originalConsoleError = console.error;

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const [first] = args;

    if (
      typeof first === 'string' &&
      (first.includes('not wrapped in act') ||
        first.includes('Warning: An update to'))
    ) {
      throw new Error(first);
    }

    originalConsoleError(...(args as Parameters<typeof console.error>));
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});
