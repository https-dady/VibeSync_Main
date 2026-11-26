import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';
import AppText from '../components/AppText';
import Icon from '../components/Icon';
import HomeScreen from '../screens/HomeScreen';
import DiscoverRoomsScreen from '../screens/DiscoverRoomsScreen';
import NearbyScreen from '../screens/NearbyScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const TAB_META = {
  Home: { icon: 'home', label: 'Home' },
  Rooms: { icon: 'rooms', label: 'Rooms' },
  Nearby: { icon: 'nearby', label: 'Nearby' },
  Profile: { icon: 'user', label: 'You' },
};

function VibeTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = TAB_META[route.name] || { icon: 'home', label: route.name };
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              onPress={onPress}
              onLongPress={() =>
                navigation.emit({ type: 'tabLongPress', target: route.key })
              }
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Icon
                  name={meta.icon}
                  size={20}
                  color={focused ? colors.black : colors.textMuted}
                  strokeWidth={focused ? 2.2 : 1.9}
                />
              </View>
              <AppText
                variant="micro"
                color={focused ? colors.offWhite : colors.textFaint}
                style={styles.label}
              >
                {meta.label.toUpperCase()}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function renderTabBar(props) {
  return <VibeTabBar {...props} />;
}

export default function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, lazy: true }} tabBar={renderTabBar}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Rooms" component={DiscoverRoomsScreen} />
      <Tab.Screen name="Nearby" component={NearbyScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.black,
    paddingTop: 8,
    paddingHorizontal: spacing.md,
  },
  bar: {
    minHeight: 62,
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 36,
    height: 31,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.orange,
  },
  label: {
    letterSpacing: 0.8,
    fontSize: 9,
  },
});
