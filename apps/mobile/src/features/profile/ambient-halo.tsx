import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { useReducedMotion } from '@/lib/a11y/use-reduced-motion';
import { useTheme } from '@/lib/theme/theme-provider';

/** Un ciclo completo de ida y vuelta: lo bastante lento para no notarse. */
const DRIFT_DURATION_MS = 14000;
const DRIFT_DISTANCE = 18;

/**
 * Luz ambiental de la banda de bienvenida.
 *
 * Dos halos radiales detrás del contenido que se desplazan muy lento. Es lo
 * ÚNICO que se mueve en el inicio: ninguna tarjeta ni texto se anima, y el
 * halo no participa del layout (es absoluto y no recibe toques). Con "Reducir
 * movimiento" queda quieto en su posición de reposo.
 */
export function AmbientHalo() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [drift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      drift.stopAnimation();
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: DRIFT_DURATION_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: DRIFT_DURATION_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true
        })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [drift, reducedMotion]);

  const primaryShift = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -DRIFT_DISTANCE]
  });
  const secondaryShift = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, DRIFT_DISTANCE]
  });

  return (
    <>
      <Animated.View
        testID="ambient-halo"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.halo,
          styles.primary,
          {
            experimental_backgroundImage: `radial-gradient(circle, ${colors.band.halo} 0%, rgba(0, 0, 0, 0) 70%)`,
            transform: [{ translateX: primaryShift }, { translateY: secondaryShift }]
          }
        ]}
      />
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.halo,
          styles.secondary,
          {
            experimental_backgroundImage: `radial-gradient(circle, ${colors.band.haloSecondary} 0%, rgba(0, 0, 0, 0) 70%)`,
            transform: [{ translateX: secondaryShift }]
          }
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    borderRadius: 999
  },
  primary: {
    width: 340,
    height: 340,
    top: -150,
    right: -130
  },
  secondary: {
    width: 300,
    height: 300,
    bottom: -150,
    left: -150
  }
});
