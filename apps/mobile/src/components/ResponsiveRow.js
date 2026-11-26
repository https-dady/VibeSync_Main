import React from 'react';
import { View, useWindowDimensions } from 'react-native';

// Recompute after rotation, split-screen changes and system font scaling.
export default function ResponsiveRow({ children, style, breakpoint = 380 }) {
  const { width, fontScale } = useWindowDimensions();
  const stack = width < breakpoint || fontScale > 1.3;
  return <View style={[style, stack && { flexDirection: 'column' }]}>{children}</View>;
}
