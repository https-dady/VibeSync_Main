import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    secureTextEntry,
    value,
    onChangeText,
    placeholder,
    autoCapitalize = 'none',
    autoCorrect = false,
    keyboardType = 'default',
    multiline = false,
    maxLength,
    editable = true,
    leftIcon,
    rightElement,
    style,
    inputStyle,
    onSubmitEditing,
    returnKeyType,
    accessibilityLabel,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));

  return (
    <View style={style}>
      {label ? (
        <AppText variant="caption" color={colors.textMuted} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.container,
          multiline && styles.multilineContainer,
          focused && styles.focused,
          error && styles.errored,
          !editable && styles.disabled,
        ]}
      >
        {leftIcon ? <Icon name={leftIcon} size={19} color={colors.textMuted} /> : null}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={hidden}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          editable={editable}
          selectionColor={colors.orange}
          cursorColor={colors.orange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          accessibilityLabel={accessibilityLabel || label || placeholder}
          style={[
            styles.input,
            multiline && styles.multiline,
            { color: colors.offWhite },
            inputStyle,
          ]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={10}
            onPress={() => setHidden((current) => !current)}
          >
            <AppText variant="caption" color={colors.orange} weight="800">
              {hidden ? 'SHOW' : 'HIDE'}
            </AppText>
          </Pressable>
        ) : null}
        {rightElement}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.orange} style={styles.helper}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.helper}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
    letterSpacing: 0.3,
  },
  container: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  multilineContainer: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  focused: {
    borderColor: colors.orange,
    backgroundColor: colors.card,
  },
  errored: {
    borderColor: colors.orange,
  },
  disabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    minWidth: 0,
    ...typography.bodyLarge,
    paddingVertical: spacing.xs,
  },
  multiline: {
    minHeight: 86,
    textAlignVertical: 'top',
    paddingTop: 2,
  },
  helper: {
    marginTop: spacing.xs,
  },
});
