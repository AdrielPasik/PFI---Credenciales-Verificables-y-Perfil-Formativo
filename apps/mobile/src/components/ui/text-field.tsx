import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useId, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps
} from 'react-native';

import { ScopeText } from '@/components/ui/text';
import {
  colors,
  layout,
  radii,
  spacing,
  typography
} from '@/lib/theme/tokens';

export interface ScopeTextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  /** Muestra el control de mostrar/ocultar contraseña. */
  secureToggle?: boolean;
}

/**
 * Campo de texto accesible.
 *
 * El error se asocia al campo mediante `accessibilityLabel` extendido y se
 * anuncia con `accessibilityLiveRegion`: en un formulario nativo no hay
 * `aria-describedby`, así que la relación se expresa así.
 */
export const ScopeTextField = forwardRef<TextInput, ScopeTextFieldProps>(
  function ScopeTextField(
    { label, error, secureToggle = false, style, ...props },
    ref
  ) {
    const [secureVisible, setSecureVisible] = useState(false);
    const errorId = useId();
    const invalid = Boolean(error);

    return (
      <View style={styles.field}>
        <ScopeText variant="smallStrong" tone="strong" nativeID={`${errorId}-label`}>
          {label}
        </ScopeText>
        <View
          style={[
            styles.inputWrapper,
            invalid && styles.inputWrapperInvalid,
            props.editable === false && styles.inputWrapperDisabled
          ]}
        >
          <TextInput
            ref={ref}
            {...props}
            accessibilityLabel={error ? `${label}. ${error}` : label}
            accessibilityState={{ disabled: props.editable === false }}
            placeholderTextColor={colors.text.subtle}
            secureTextEntry={secureToggle ? !secureVisible : props.secureTextEntry}
            style={[styles.input, style]}
          />
          {secureToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                secureVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'
              }
              accessibilityState={{ selected: secureVisible }}
              onPress={() => setSecureVisible((value) => !value)}
              style={styles.secureToggle}
            >
              <Ionicons
                name={secureVisible ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.text.muted}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <ScopeText
            variant="caption"
            tone="error"
            accessibilityLiveRegion="polite"
          >
            {error}
          </ScopeText>
        ) : null}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.touchTarget + 4,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.lg
  },
  inputWrapperInvalid: {
    borderColor: colors.status.error
  },
  inputWrapperDisabled: {
    opacity: 0.6
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text.strong,
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily
  },
  secureToggle: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
