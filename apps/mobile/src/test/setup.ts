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
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRouteState.searchParams,
  usePathname: () => mockRouteState.pathname,
  useIsFocused: () => true,
  Redirect: ({ href }: { href: unknown }) => {
    mockRouteState.redirects.push(href);
    return null;
  },
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
  Link: () => null
}));

/**
 * Navegacion simulada. `usePreventRemove` registra la guarda vigente y
 * `simulateLeave` reproduce lo que hace el stack nativo ante la flecha del
 * header, el Atras de Android o el gesto de iOS: si la salida esta prevenida,
 * llama al callback; si no, despacha la accion.
 */
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockRouteState = {
  searchParams: {} as Record<string, string | undefined>,
  pathname: '/',
  redirects: [] as unknown[]
};
const mockNavigation = {
  dispatch: jest.fn(),
  prevent: null as null | {
    enabled: boolean;
    callback: (options: { data: { action: unknown } }) => void;
  }
};

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => mockNavigation,
  usePreventRemove: (
    enabled: boolean,
    callback: (options: { data: { action: unknown } }) => void
  ) => {
    mockNavigation.prevent = { enabled, callback };
  }
}));

export const testNavigation = {
  router: mockRouter,
  route: mockRouteState,
  navigation: mockNavigation,
  simulateLeave(action: unknown = { type: 'GO_BACK' }) {
    if (mockNavigation.prevent?.enabled) {
      mockNavigation.prevent.callback({ data: { action } });
    } else {
      mockNavigation.dispatch(action);
    }
  },
  reset() {
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();
    mockRouter.back.mockReset();
    mockNavigation.dispatch.mockReset();
    mockNavigation.prevent = null;
    mockRouteState.searchParams = {};
    mockRouteState.pathname = '/';
    mockRouteState.redirects = [];
  }
};

export function resetSecureStore() {
  mockSecureStoreValues.clear();
}

beforeEach(() => {
  testNavigation.reset();
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
