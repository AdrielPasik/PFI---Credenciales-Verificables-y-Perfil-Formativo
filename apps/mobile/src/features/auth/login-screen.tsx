import { useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeButton } from '@/components/ui/button';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { ScopeTextField } from '@/components/ui/text-field';
import type { LoginCommand } from '@/lib/api/scope-api';
import { colors, layout, spacing } from '@/lib/theme/tokens';
import type { AuthFeedback } from '@/types/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

/**
 * Pantalla de acceso.
 *
 * Es holder-oriented: no menciona instituciones, no pregunta "¿sos institución
 * o titular?" y no ofrece recuperación de contraseña ni SSO. El registro
 * utiliza el contrato público existente de autenticación y sigue siendo una
 * experiencia exclusivamente Holder.
 *
 * La contraseña se limpia después de cada intento y NUNCA se persiste.
 */
export function LoginScreen({
  onSubmit,
  onCreateAccount,
  submitting,
  initialFeedback
}: {
  onSubmit: (command: LoginCommand) => Promise<AuthFeedback | null>;
  onCreateAccount: () => void;
  submitting: boolean;
  initialFeedback: AuthFeedback | null;
}) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<AuthFeedback | null>(
    initialFeedback
  );
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    // Evita envíos duplicados por doble toque o por Enter mientras carga.
    if (submitting) return;

    setFeedback(null);

    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: FieldErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = 'Ingresá tu correo electrónico.';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextErrors.email = 'Ingresá un correo electrónico válido.';
    }

    if (!password) {
      nextErrors.password = 'Ingresá tu contraseña.';
    }

    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    const nextFeedback = await onSubmit({
      email: normalizedEmail,
      password
    });

    setPassword('');

    if (nextFeedback) setFeedback(nextFeedback);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.huge,
            paddingBottom: insets.bottom + spacing.huge
          }
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          <View style={styles.brand}>
            <Image
              accessibilityIgnoresInvertColors
              accessible
              accessibilityRole="image"
              accessibilityLabel="Scope"
              source={require('../../../assets/brand-lockup.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <ScopeText variant="small" tone="muted" style={styles.tagline}>
              Una nueva forma de entender tu trayectoria.
            </ScopeText>
          </View>

          <View style={styles.intro}>
            <ScopeText
              variant="screenTitle"
              tone="strong"
              accessibilityRole="header"
            >
              Iniciá sesión
            </ScopeText>
            <ScopeText variant="small" tone="muted">
              Accedé para consultar tus credenciales y entender tu perfil
              formativo.
            </ScopeText>
          </View>

          {feedback ? (
            <ScopeNotice tone="error" title="No pudimos iniciar sesión">
              <ScopeText variant="small" style={styles.errorText}>
                {feedback.message}
              </ScopeText>
            </ScopeNotice>
          ) : null}

          <View style={styles.form}>
            <ScopeTextField
              testID="login-email"
              label="Correo electrónico"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
              error={fieldErrors.email}
              editable={!submitting}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="tu@correo.com"
            />

            <ScopeTextField
              testID="login-password"
              ref={passwordRef}
              label="Contraseña"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFieldErrors((current) => ({
                  ...current,
                  password: undefined
                }));
              }}
              error={fieldErrors.password}
              editable={!submitting}
              secureToggle
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />

            <ScopeButton
              testID="login-submit"
              fullWidth
              label="Ingresar"
              loadingLabel="Ingresando"
              loading={submitting}
              onPress={() => void submit()}
            />

            <View style={styles.registerPrompt}>
              <ScopeText variant="small" tone="muted">
                ¿Todavía no tenés una cuenta?
              </ScopeText>
              <ScopeButton
                testID="login-create-account"
                variant="ghost"
                label="Crear cuenta"
                disabled={submitting}
                onPress={onCreateAccount}
              />
            </View>
          </View>

          <ScopeText variant="caption" tone="subtle" style={styles.footer}>
            Scope es tu espacio personal de credenciales formativas. Sólo vos
            ves tu perfil, salvo que decidas compartirlo.
          </ScopeText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface.background
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingHorizontal
  },
  inner: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.xxl
  },
  brand: {
    alignItems: 'center',
    gap: spacing.md
  },
  logo: {
    width: 128,
    height: 158
  },
  tagline: {
    textAlign: 'center'
  },
  intro: {
    gap: spacing.xs
  },
  form: {
    gap: spacing.lg
  },
  registerPrompt: {
    alignItems: 'center',
    gap: spacing.xs
  },
  footer: {
    textAlign: 'center'
  },
  errorText: {
    color: colors.status.error
  }
});
