import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getSocketUrl } from '../config';
import {
  getValidAccessToken,
  refreshSession,
} from '../api/session';
import { subscribeAuthEvents } from '../services/authEvents';
import { ClockSync } from '../sync/ClockSync';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function realtimeError(
  payload,
  fallback = 'Realtime operation failed',
) {
  const error = new Error(payload?.message || fallback);
  error.code = payload?.code || 'REALTIME_ERROR';
  error.details = payload?.details;
  return error;
}

export function SocketProvider({ children }) {
  const { user, isAuthenticated } = useAuth();

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('idle');
  const [networkOnline, setNetworkOnline] = useState(true);
  const [connectionError, setConnectionError] = useState(null);

  const [clockState, setClockState] = useState({
    offsetMs: 0,
    rttMs: null,
    quality: 'unknown',
    sampleCount: 0,
  });

  const socketRef = useRef(null);
  const clockRef = useRef(new ClockSync());
  const clockTimerRef = useRef(null);
  const recoveringRef = useRef(false);
  const connectedRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const networkOnlineRef = useRef(networkOnline);
  const samplingRef = useRef(false);
  networkOnlineRef.current = networkOnline;

  const sampleClock = useCallback(async (count = 1) => {
    const activeSocket = socketRef.current;

    if (!activeSocket?.connected || samplingRef.current) return;
    samplingRef.current = true;

    try {
    for (let index = 0; index < count; index += 1) {
      if (socketRef.current !== activeSocket || !activeSocket.connected) break;
      const t0 = Date.now();

      await new Promise((resolve) => {
        activeSocket.timeout(5000).emit(
          'clock:sync',
          { t0 },
          (timeoutError, response) => {
            const t2 = Date.now();

            if (!timeoutError && response?.ok && socketRef.current === activeSocket) {
              clockRef.current.addSample({
                t0: response.t0 ?? t0,
                serverTime: response.serverTime,
                t2,
              });

              setClockState(clockRef.current.snapshot());
            }

            resolve();
          },
        );
      });

      if (index + 1 < count) {
        await new Promise((resolve) =>
          setTimeout(resolve, 220),
        );
      }
    }
    } finally {
      samplingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const client = socketRef.current;
    if (!client || !isAuthenticated) return;
    if (!networkOnline) {
      setConnectionState('offline');
      client.disconnect();
    } else if (!client.connected) {
      setConnectionState('reconnecting');
      client.connect();
    }
  }, [isAuthenticated, networkOnline, socket]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clockRef.current.reset();
      setClockState(clockRef.current.snapshot());
      const client = socketRef.current;
      if (client?.connected) sampleClock(3);
      else if (client && networkOnlineRef.current) client.connect();
    });
    return () => subscription.remove();
  }, [sampleClock]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetworkOnline(state.isConnected !== false);
    });

    NetInfo.fetch()
      .then((state) =>
        setNetworkOnline(state.isConnected !== false),
      )
      .catch(() => {});

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      connectedRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      setSocket(null);
      setConnected(false);
      setConnectionState('idle');
      setConnectionError(null);

      if (clockTimerRef.current) {
        clearInterval(clockTimerRef.current);
      }

      clockTimerRef.current = null;

      return undefined;
    }

    setConnectionState('connecting');

    const client = io(getSocketUrl(), {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.35,
      timeout: 15000,

      auth: (callback) => {
        getValidAccessToken()
          .then((token) => {
            callback(token ? { token } : {});
          })
          .catch(() => {
            callback({});
          });
      },
    });

    socketRef.current = client;
    setSocket(client);

    const handleConnect = () => {
      connectedRef.current = true;

      setConnected(true);
      setConnectionState('connected');
      setConnectionError(null);

      sampleClock(3);
    };

    const handleDisconnect = (reason) => {
      connectedRef.current = false;
      setConnected(false);

      setConnectionState(
        reason === 'io client disconnect'
          ? 'idle'
          : networkOnlineRef.current
            ? 'reconnecting'
            : 'offline',
      );
    };

    const reconnectWithFreshToken = () => {
      if (socketRef.current !== client) return;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;

        if (socketRef.current !== client) return;

        if (client.connected) {
          client.disconnect();
        }

        client.connect();
      }, 300);
    };

    const handleConnectError = async (error) => {
      setConnected(false);

      setConnectionError(
        error?.message || 'Unable to reach the live service',
      );

      const code = error?.message || '';

      const authFailure = [
        'AUTH_REQUIRED',
        'AUTH_INVALID',
        'AUTH_FAILED',
      ].includes(code);

      if (authFailure && !recoveringRef.current) {
        recoveringRef.current = true;

        try {
          await refreshSession();
          reconnectWithFreshToken();
        } catch {
          setConnectionState('offline');
        } finally {
          recoveringRef.current = false;
        }
      } else {
        setConnectionState(
          networkOnlineRef.current ? 'reconnecting' : 'offline',
        );
      }
    };

    const handleAuthExpired = async () => {
      if (recoveringRef.current) return;

      recoveringRef.current = true;
      setConnectionState('reconnecting');

      try {
        await refreshSession();
        reconnectWithFreshToken();
      } catch {
        setConnectionState('offline');
      } finally {
        recoveringRef.current = false;
      }
    };

    const handleReconnectAttempt = () => {
      setConnectionState(
        networkOnlineRef.current ? 'reconnecting' : 'offline',
      );
    };

    // Axios refresh and native player refresh both emit this event.
    // Reconnect Socket.IO so its auth callback supplies the latest token.
    const unsubscribeAuth = subscribeAuthEvents((event) => {
      if (event.type !== 'session:refreshed') return;

      reconnectWithFreshToken();
    });

    client.on('connect', handleConnect);
    client.on('disconnect', handleDisconnect);
    client.on('connect_error', handleConnectError);
    client.on('auth:expired', handleAuthExpired);

    client.io.on(
      'reconnect_attempt',
      handleReconnectAttempt,
    );

    client.connect();

    const clockTimer = setInterval(() => {
      if (client.connected) {
        sampleClock(2);
      }
    }, 30000);

    clockTimerRef.current = clockTimer;

    return () => {
      connectedRef.current = false;

      unsubscribeAuth();

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      client.removeAllListeners();
      client.io.removeAllListeners('reconnect_attempt');

      client.disconnect();

      clearInterval(clockTimer);

      if (clockTimerRef.current === clockTimer) {
        clockTimerRef.current = null;
      }

      if (socketRef.current === client) {
        socketRef.current = null;
        setSocket(null);
      }
    };
  }, [
    isAuthenticated,
    user?.id,
    sampleClock,
  ]);

  const emitAck = useCallback(
    (event, payload = {}, timeoutMs = 12000) => {
      const activeSocket = socketRef.current;

      if (!activeSocket?.connected) {
        const error = new Error(
          'Not connected to the live service',
        );

        error.code = 'NOT_CONNECTED';

        return Promise.reject(error);
      }

      return new Promise((resolve, reject) => {
        activeSocket
          .timeout(timeoutMs)
          .emit(event, payload, (timeoutError, response) => {
            if (timeoutError) {
              reject(
                realtimeError({
                  code: 'REALTIME_TIMEOUT',
                  message: 'The live service did not respond',
                }),
              );

              return;
            }

            if (!response || response.ok === false) {
              reject(realtimeError(response?.error));
              return;
            }

            resolve(response);
          });
      });
    },
    [],
  );

  const serverNow = useCallback(
    () => clockRef.current.serverNow(),
    [],
  );

  const reconnect = useCallback(() => {
    const activeSocket = socketRef.current;

    if (!activeSocket) return;

    if (activeSocket.connected) {
      activeSocket.disconnect();
    }

    activeSocket.connect();
  }, []);

  const value = useMemo(
    () => ({
      socket,
      connected,
      connectionState,
      connectionError,
      networkOnline,
      clock: clockState,
      clockRef,
      emitAck,
      sampleClock,
      serverNow,
      reconnect,
      isOnline: networkOnline && connected,
    }),
    [
      socket,
      connected,
      connectionState,
      connectionError,
      networkOnline,
      clockState,
      emitAck,
      sampleClock,
      serverNow,
      reconnect,
    ],
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const value = useContext(SocketContext);

  if (!value) {
    throw new Error(
      'useSocket must be used inside SocketProvider',
    );
  }

  return value;
}
