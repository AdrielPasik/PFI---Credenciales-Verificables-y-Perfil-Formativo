import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeText } from '@/components/ui/text';
import { colors, radii, spacing } from '@/lib/theme/tokens';

/**
 * Entrada a Objetivos desde el perfil.
 *
 * Va entre el perfil formativo y las credenciales. El perfil sigue siendo la
 * respuesta a "quién soy", que es la promesa de esa pantalla; el objetivo es la
 * pregunta siguiente, no la primera.
 *
 * "Ver mis objetivos" está SIEMPRE visible. Condicionarlo a que exista al menos
 * uno obligaría a pedir la lista sólo para decidir si se dibuja un botón, y eso
 * agregaría una petición y un salto de layout a la pantalla principal. La
 * pantalla de lista ya tiene su estado vacío.
 *
 * Ninguna de las dos acciones gasta una llamada al proveedor: sólo navegan.
 */
export function ObjectiveEntryCard() {
  const router = useRouter();

  return (
    <ScopeCard style={styles.card} testID="objective-entry-card">
      <View style={styles.heading}>
        <View style={styles.icon}>
          <Ionicons
            name="compass-outline"
            size={20}
            color={colors.brand.teal}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </View>
        <ScopeText variant="overline" tone="teal">
          Objetivos
        </ScopeText>
      </View>

      <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
        Analizá tu trayectoria en contexto
      </ScopeText>

      <ScopeText variant="small" tone="muted">
        Usá una búsqueda laboral, beca, admisión u otro objetivo para entender
        qué podés justificar con la evidencia de tus credenciales.
      </ScopeText>

      <View style={styles.actions}>
        <ScopeButton
          testID="objective-entry-analyze"
          label="Analizar un objetivo"
          onPress={() => router.push('/objectives/new')}
          accessibilityHint="Abre la pantalla para preparar un objetivo nuevo"
        />
        <ScopeButton
          testID="objective-entry-list"
          variant="secondary"
          label="Ver mis objetivos"
          onPress={() => router.push('/objectives')}
        />
      </View>
    </ScopeCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderColor: colors.brand.cyan
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.brand.tint
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm
  }
});
