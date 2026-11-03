import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Preferencia del sistema "Reducir movimiento".
 *
 * Arranca en `true` hasta que el sistema responde: es más seguro no animar un
 * instante de más que animar a alguien que pidió no hacerlo.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => setReduced(value)
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
