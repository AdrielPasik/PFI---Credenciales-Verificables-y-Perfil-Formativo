import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { AccountMenuButton } from '@/features/auth/account-menu-button';
import { colors, typography } from '@/lib/theme/tokens';

/**
 * Dos destinos, y sólo dos.
 *
 * Perfil ES el inicio del titular: no hay un "Home" separado del perfil, y no
 * hay una pestaña de ajustes vacía sólo para alojar el cierre de sesión
 * (secciones 13, 116 y 117 del encargo). Cerrar sesión vive en el menú de
 * cuenta del encabezado.
 */
export default function HolderTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface.card },
        headerTitleStyle: {
          color: colors.text.strong,
          fontFamily: typography.cardTitle.fontFamily,
          fontSize: typography.cardTitle.fontSize
        },
        headerShadowVisible: false,
        headerRight: () => <AccountMenuButton />,
        tabBarActiveTintColor: colors.brand.teal,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarStyle: {
          backgroundColor: colors.surface.card,
          borderTopColor: colors.border.default
        },
        tabBarLabelStyle: {
          fontFamily: typography.caption.fontFamily,
          fontSize: typography.caption.fontSize
        },
        sceneStyle: { backgroundColor: colors.surface.background }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Perfil',
          tabBarAccessibilityLabel: 'Perfil formativo',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          )
        }}
      />
      <Tabs.Screen
        name="credentials"
        options={{
          title: 'Credenciales',
          tabBarAccessibilityLabel: 'Mis credenciales',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ribbon-outline" color={color} size={size} />
          )
        }}
      />
    </Tabs>
  );
}
