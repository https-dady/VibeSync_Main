module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Small dynamic overrides (flex, opacity, alignment) stay inline; shared
    // styling still lives in the design system and StyleSheet objects.
    'react-native/no-inline-styles': 'off',
  },
};
