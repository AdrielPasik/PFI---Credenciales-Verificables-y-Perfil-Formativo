import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/**
 * Protege una pantalla con cambios sin guardar.
 *
 * `usePreventRemove` intercepta TODA salida que quite la pantalla del stack:
 * flecha del header, botón Atrás de Android y gesto de regreso de iOS (el stack
 * nativo deshabilita el gesto mientras la salida está prevenida). Antes de salir
 * se pide confirmación nativa; "Seguir editando" no toca nada.
 *
 * Una salida legítima (por ejemplo, después de confirmar el objetivo) pasa por
 * `leave`: primero libera la guarda y recién en el render siguiente navega, para
 * que la propia salida no vuelva a dispararla.
 */
export function useDiscardGuard(dirty: boolean) {
  const navigation = useNavigation();
  const [released, setReleased] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  // Un solo diálogo a la vez, aunque lleguen dos intentos seguidos.
  const askingRef = useRef(false);

  usePreventRemove(dirty && !released, ({ data }) => {
    if (askingRef.current) return;
    askingRef.current = true;
    Alert.alert(
      '¿Salir sin guardar?',
      'Vas a perder el texto del objetivo y la revisión de requisitos.',
      [
        {
          text: 'Seguir editando',
          style: 'cancel',
          onPress: () => {
            askingRef.current = false;
          }
        },
        {
          text: 'Salir y descartar',
          style: 'destructive',
          onPress: () => {
            askingRef.current = false;
            navigation.dispatch(data.action);
          }
        }
      ],
      {
        cancelable: true,
        onDismiss: () => {
          askingRef.current = false;
        }
      }
    );
  });

  useEffect(() => {
    if (!released || pendingRef.current === null) return;
    const navigate = pendingRef.current;
    pendingRef.current = null;
    navigate();
  }, [released]);

  const leave = useCallback((navigate: () => void) => {
    pendingRef.current = navigate;
    setReleased(true);
  }, []);

  return { leave };
}
