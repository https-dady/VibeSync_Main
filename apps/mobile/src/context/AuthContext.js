import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { authApi } from '../api/endpoints';
import {
  clearSession,
  getSessionSnapshot,
  initializeSession,
  persistSession,
} from '../api/session';
import { subscribeAuthEvents } from '../services/authEvents';
import {
  cacheUser,
  clearRecentRooms,
  getApiOverride,
  getCachedUser,
  setApiOverride,
} from '../services/storage';
import { setApiBaseUrl } from '../config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const authGeneration = useRef(0);

  const applyUser = useCallback(async (nextUser) => {
    setUser(nextUser);
    await cacheUser(nextUser);
  }, []);

  const bootstrap = useCallback(async () => {
    const generation = authGeneration.current;
    try {
      const override = await getApiOverride().catch(() => null);
      if (override) {
        try { setApiBaseUrl(override); }
        catch {
          await setApiOverride(null);
          await clearSession();
          await cacheUser(null);
          setApiBaseUrl(null);
          setNotice('The saved API server was invalid. Sign in to reconnect.');
          setUser(null);
          return;
        }
      }
      const session = await initializeSession();
      if (!mounted.current || authGeneration.current !== generation) return;
      if (!session?.refreshToken) {
        setUser(null);
        return;
      }
      const cached = await getCachedUser();
      if (cached && mounted.current) setUser(cached);
      const fresh = await authApi.me();
      if (mounted.current && authGeneration.current === generation) await applyUser(fresh);
    } catch (error) {
      if (authGeneration.current !== generation) return;
      if (error?.code === 'SESSION_EXPIRED') {
        if (mounted.current) {
          setUser(null);
          setNotice('Your session expired. Sign in to continue.');
        }
      } else if (mounted.current) {
        // Network failure: keep the cached profile and let individual screens
        // surface connectivity errors. Tokens remain securely stored.
        const cached = await getCachedUser().catch(() => null);
        if (cached && getSessionSnapshot()?.refreshToken) setUser(cached);
      }
    } finally {
      if (mounted.current) setBooting(false);
    }
  }, [applyUser]);

  useEffect(() => {
    mounted.current = true;
    bootstrap();
    const unsubscribe = subscribeAuthEvents((event) => {
      if (event.type === 'session:expired' || event.type === 'session:cleared') {
        setUser(null);
        cacheUser(null).catch(() => {});
        if (event.type === 'session:expired') setNotice('Your session expired. Sign in again to keep listening together.');
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [bootstrap]);

  const login = useCallback(
    async (email, password) => {
      const generation = ++authGeneration.current;
      setBusy(true);
      setNotice(null);
      try {
        const result = await authApi.login(email.trim().toLowerCase(), password);
        if (authGeneration.current !== generation) throw new Error('Sign-in was cancelled');
        await persistSession(result);
        if (authGeneration.current !== generation) throw new Error('Sign-in was cancelled');
        await applyUser(result.user);
        return result.user;
      } finally {
        setBusy(false);
      }
    },
    [applyUser],
  );

  const register = useCallback(
    async ({ name, email, password }) => {
      const generation = ++authGeneration.current;
      setBusy(true);
      setNotice(null);
      try {
        const result = await authApi.register({ name, email: email.trim().toLowerCase(), password });
        if (authGeneration.current !== generation) throw new Error('Registration was cancelled');
        await persistSession(result);
        if (authGeneration.current !== generation) throw new Error('Registration was cancelled');
        await applyUser(result.user);
        return result.user;
      } finally {
        setBusy(false);
      }
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    const generation = ++authGeneration.current;
    const session = getSessionSnapshot();
    try {
      if (session?.refreshToken) await authApi.logout(session.refreshToken);
    } catch {
      // Local sign-out must always succeed even if the network is unavailable.
    }
    if (authGeneration.current !== generation) return;
    await clearSession();
    await cacheUser(null);
    await clearRecentRooms();
    setUser(null);
    setNotice(null);
  }, []);

  const updateProfile = useCallback(
    async (updates) => {
      const updated = await authApi.updateProfile(updates);
      await applyUser(updated);
      return updated;
    },
    [applyUser],
  );

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    authGeneration.current += 1;
    await authApi.changePassword(currentPassword, newPassword);
    await clearSession();
    await cacheUser(null);
    setUser(null);
    setNotice('Password changed. Sign in with your new password.');
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await authApi.me();
    await applyUser(fresh);
    return fresh;
  }, [applyUser]);

  const value = useMemo(
    () => ({
      booting,
      user,
      notice,
      busy,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      updateProfile,
      changePassword,
      refreshUser,
      clearNotice: () => setNotice(null),
    }),
    [booting, user, notice, busy, login, register, logout, updateProfile, changePassword, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
