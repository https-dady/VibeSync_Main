import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Respect both the system accessibility preference and the account setting. */
export default function useReducedMotion(appPreference = false) {
  const [systemPreference, setSystemPreference] = useState(false);
  useEffect(() => {
    let active = true;
    let eventReceived = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      eventReceived = true;
      if (active) setSystemPreference(Boolean(value));
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !eventReceived) setSystemPreference(Boolean(value));
    }).catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return Boolean(appPreference || systemPreference);
}
