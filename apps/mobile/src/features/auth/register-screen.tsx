import { useRef, useState } from 'react';
import {
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
import type { RegisterCommand } from '@/lib/api/scope-api';
import { colors, layout, spacing } from '@/lib/theme/tokens';
import type { AuthFeedback } from '@/types/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/** Registro Holder que replica únicamente las reglas públicas del backend. */
export function RegisterScreen({
  onSubmit,
  onBack,
  submitting
}: {
  onSubmit: (command: RegisterCommand) => Promise<AuthFeedback | null>;
  onBack: () => void;
  submitting: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  async function submit() {
    if (submitting) return;

    setFeedback(null);
    const normalizedFirstName = firstName.trim().replace(/\s+/g, ' ');
    const normalizedLastName = lastName.trim().replace(/\s+/g, ' ');
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: FieldErrors = {};

    if (!normalizedFirstName) {
      nextErrors.firstName = 'Ingresá tu nombre.';
    } else if (normalizedFirstName.length > MAX_NAME_LENGTH) {
      nextErrors.firstName = `El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.`;
    }

    if (!normalizedLastName) {
      nextErrors.lastName = 'Ingresá tu apellido.';
    } else if (normalizedLastName.length > MAX_NAME_LENGTH) {
      nextErrors.lastName = `El apellido no puede superar los ${MAX_NAME_LENGTH} caracteres.`;
    }

    if (!normalizedEmail) {
      nextErrors.email = 'Ingresá tu correo electrónico.';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextErrors.email = 'Ingresá un correo electrónico válido.';
    }

    if (!password) {
      nextErrors.password = 'Ingresá una contraseña.';
    } else if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      nextErrors.password = `La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`;
    }

    if (!nextErrors.password && password !== confirmPassword) {
      nextErrors.confirmPassword = 'Las contraseñas no coinciden.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const nextFeedback = await onSubmit({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      email: normalizedEmail,
      password
    });

    // La confirmación es local y ninguna contraseña sale de este formulario.
    setPassword('');
    setConfirmPassword('');
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
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: insets.bottom + spacing.huge
          }
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          <View style={styles.intro}>
            <ScopeText variant="screenTitle" tone="strong" accessibilityRole="header">
              Crear cuenta
            </ScopeText>
            <ScopeText variant="small" tone="muted">
              Creá tu acceso para consultar tus credenciales y tu perfil formativo.
            </ScopeText>
          </View>

          {feedback ? (
            <ScopeNotice tone="error" title="No pudimos crear tu cuenta">
              <ScopeText variant="small" style={styles.errorText}>
                {feedback.message}
              </ScopeText>
            </ScopeNotice>
          ) : null}

          <View style={styles.form}>
            <ScopeTextField
              testID="register-first-name"
              label="Nombre"
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setFieldErrors((current) => ({ ...current, firstName: undefined }));
              }}
              error={fieldErrors.firstName}
              editable={!submitting}
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              onSubmitEditing={() => lastNameRef.current?.focus()}
            />
            <ScopeTextField
              testID="register-last-name"
              ref={lastNameRef}
              label="Apellido"
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setFieldErrors((current) => ({ ...current, lastName: undefined }));
              }}
              error={fieldErrors.lastName}
              editable={!submitting}
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
            <ScopeTextField
              testID="register-email"
              ref={emailRef}
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
              testID="register-password"
              ref={passwordRef}
              label="Contraseña"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFieldErrors((current) => ({
                  ...current,
                  password: undefined,
                  confirmPassword: undefined
                }));
              }}
              error={fieldErrors.password}
              editable={!submitting}
              secureToggle
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            />
            <ScopeTextField
              testID="register-confirm-password"
              ref={confirmPasswordRef}
              label="Repetir contraseña"
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                setFieldErrors((current) => ({ ...current, confirmPassword: undefined }));
              }}
              error={fieldErrors.confirmPassword}
              editable={!submitting}
              secureToggle
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            <ScopeButton
              testID="register-submit"
              fullWidth
              label="Crear cuenta"
              loadingLabel="Creando cuenta"
              loading={submitting}
              onPress={() => void submit()}
            />
          </View>

          <View style={styles.loginPrompt}>
            <ScopeText variant="small" tone="muted">
              ¿Ya tenés una cuenta?
            </ScopeText>
            <ScopeButton
              testID="register-back-to-login"
              variant="ghost"
              label="Iniciá sesión"
              disabled={submitting}
              onPress={onBack}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface.background },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingHorizontal
  },
  inner: { width: '100%', maxWidth: 420, gap: spacing.xxl },
  intro: { gap: spacing.xs },
  form: { gap: spacing.lg },
  loginPrompt: { alignItems: 'center', gap: spacing.xs },
  errorText: { color: colors.status.error }
});
