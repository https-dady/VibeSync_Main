import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import Video from 'react-native-video';
import { WebView } from 'react-native-webview';
import { mediaApi } from '../api/endpoints';
import { absoluteMediaUrl } from '../api/client';
import { getValidAccessToken } from '../api/session';
import { subscribeAuthEvents } from '../services/authEvents';
import { colors, radius } from '../theme';
import AppText from '../components/AppText';
import Icon, { Waveform } from '../components/Icon';
import { decideCorrection, expectedPosition } from '../sync/PlaybackSync';
import { HOST_HEARTBEAT_INTERVAL_MS } from '../config';

const DRM_SCHEMES = new Set(['widevine', 'fairplay']);
const DIRECT_EXT_REGEX = /\.(?:mp4|m3u8|mpd|mp3|m4a|aac|wav|flac|mov|m4v|webm|mkv|ogg|ogv)(?:\?|$)/i;
const DESKTOP_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function extractYouTubeId(rawUrl) {
  if (!rawUrl) return null;
  const str = String(rawUrl).trim();
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const regex of patterns) {
    const match = str.match(regex);
    if (match?.[1]) return match[1];
  }
  return null;
}

function buildYouTubeHtml(videoId) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #player { width: 100%; height: 100%; background: #000; overflow: hidden; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    var player = null;
    var ready = false;
    var progressTimer = null;

    function send(payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }

    function onYouTubeIframeAPIReady() {
      player = new YT.Player('player', {
        videoId: '${videoId}',
        playerVars: {
          playsinline: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: 'https://www.youtube.com'
        },
        events: {
          onReady: function() {
            ready = true;
            var dur = 0;
            try { dur = player.getDuration() || 0; } catch (e) {}
            send({ type: 'loaded', duration: dur });
            progressTimer = setInterval(function() {
              if (!ready || !player) return;
              try {
                send({
                  type: 'progress',
                  currentTime: player.getCurrentTime() || 0,
                  duration: player.getDuration() || 0
                });
              } catch (e) {}
            }, 400);
          },
          onStateChange: function(event) {
            if (event.data === 3) send({ type: 'buffer', isBuffering: true });
            else if (event.data === 1) send({ type: 'buffer', isBuffering: false });
            else if (event.data === 0) send({ type: 'ended' });
          },
          onError: function(event) {
            send({ type: 'error', message: 'YouTube playback error (' + event.data + ')' });
          }
        }
      });
    }

    window.__vibesyncCmd = function(cmd, val) {
      if (!ready || !player) return;
      try {
        if (cmd === 'play') player.playVideo();
        else if (cmd === 'pause') player.pauseVideo();
        else if (cmd === 'seek') player.seekTo(Number(val) || 0, true);
        else if (cmd === 'rate') player.setPlaybackRate(Number(val) || 1);
      } catch (e) {}
    };
  </script>
</body>
</html>`;
}

const UNIVERSAL_WEB_INJECTED_JS = `
(function() {
  if (window.__vibesyncHooked) return;
  window.__vibesyncHooked = true;

  var activeVideo = null;
  var lastTime = -1;

  function send(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function findVideo(root) {
    if (!root) return null;
    var v = root.querySelector ? root.querySelector('video') : null;
    if (v) return v;
    var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        var sv = findVideo(all[i].shadowRoot);
        if (sv) return sv;
      }
    }
    return null;
  }

  function attachVideo(v) {
    if (!v || v === activeVideo) return;
    activeVideo = v;
    v.setAttribute('playsinline', 'true');
    v.setAttribute('webkit-playsinline', 'true');

    var reportMeta = function() {
      if (isFinite(v.duration) && v.duration > 0) {
        send({ type: 'loaded', duration: v.duration });
      }
    };

    v.addEventListener('loadedmetadata', reportMeta);
    v.addEventListener('durationchange', reportMeta);
    v.addEventListener('waiting', function() { send({ type: 'buffer', isBuffering: true }); });
    v.addEventListener('playing', function() { send({ type: 'buffer', isBuffering: false }); });
    v.addEventListener('ended', function() { send({ type: 'ended' }); });

    if (v.readyState >= 1) reportMeta();
  }

  setInterval(function() {
    var v = findVideo(document);
    if (v && v !== activeVideo) attachVideo(v);
    if (activeVideo) {
      var ct = Number(activeVideo.currentTime) || 0;
      var dur = isFinite(activeVideo.duration) ? activeVideo.duration : 0;
      if (Math.abs(ct - lastTime) >= 0.05 || !activeVideo.paused) {
        lastTime = ct;
        send({ type: 'progress', currentTime: ct, duration: dur });
      }
    }
  }, 400);

  window.__vibesyncCmd = function(cmd, val) {
    var v = activeVideo || findVideo(document);
    if (!v) return;
    try {
      if (cmd === 'play') {
        var p = v.play();
        if (p && p.catch) {
          p.catch(function() {
            v.muted = true;
            v.play().catch(function() {});
          });
        }
      } else if (cmd === 'pause') {
        v.pause();
      } else if (cmd === 'seek') {
        v.currentTime = Number(val) || 0;
      } else if (cmd === 'rate') {
        v.playbackRate = Number(val) || 1;
      }
    } catch (e) {}
  };
})();
true;
`;

const SyncedMediaPlayer = forwardRef(function SyncedMediaPlayer(
  {
    playback,
    media,
    isHost,
    serverNow,
    onCommand,
    reportPosition,
    style,
    onPosition,
    onDuration,
    reduceMotion = false,
    connectionState = 'connected',
  },
  ref,
) {
  const videoRef = useRef(null);
  const webViewRef = useRef(null);

  const [headers, setHeaders] = useState({});
  const [paused, setPaused] = useState(true);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState((media?.durationMs || 0) / 1000);
  const [position, setPosition] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [synchronizing, setSynchronizing] = useState(false);

  const positionRef = useRef(0);
  const playbackRef = useRef(playback);
  const mediaRef = useRef(media);
  const pulse = useRef(new Animated.Value(0.4)).current;

  const refreshingStreamRef = useRef(false);
  const streamRetryRef = useRef(false);
  const mountedRef = useRef(true);
  const loadedRef = useRef(false);
  const bufferingRef = useRef(false);
  const lastSeekRef = useRef(0);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef(null);
  const hostBufferPauseRef = useRef(null);

  playbackRef.current = playback;
  mediaRef.current = media;

  const rawUrl =
    media?.source === 'upload'
      ? absoluteMediaUrl(media?.streamUrl)
      : media?.url;

  const youtubeVideoId = useMemo(() => {
    if (!media || media.source === 'upload') return null;
    return extractYouTubeId(rawUrl);
  }, [media, rawUrl]);

  const isYouTube = Boolean(youtubeVideoId) || media?.provider === 'youtube-embed';

  const isWebEmbed = useMemo(() => {
    if (!media || media.source === 'upload' || isYouTube) return false;
    if (
      media.provider === 'web-embed' ||
      media.playbackCapabilities?.urlResolution === 'embed'
    ) {
      return true;
    }
    if (!rawUrl) return false;
    const hasDirectExt = DIRECT_EXT_REGEX.test(rawUrl);
    const hasDirectMime = /^(?:video|audio)\/|mpegurl|dash\+xml/i.test(
      String(media.mimeType || ''),
    );
    return !hasDirectExt && !hasDirectMime;
  }, [isYouTube, media, rawUrl]);

  const isNativePlayer = !isYouTube && !isWebEmbed;
  const isVideo = media?.type === 'video';
  const unsupportedPlatform =
    isNativePlayer &&
    media?.playbackCapabilities?.supportedPlatforms &&
    !media.playbackCapabilities.supportedPlatforms.includes(Platform.OS);

  const sendWebCommand = useCallback((cmd, val = '') => {
    if (!webViewRef.current) return;
    const arg = typeof val === 'number' ? val : JSON.stringify(val);
    webViewRef.current.injectJavaScript(
      `window.__vibesyncCmd && window.__vibesyncCmd(${JSON.stringify(cmd)}, ${arg}); true;`,
    );
  }, []);

  const source = useMemo(() => {
    if (!media || !isNativePlayer || unsupportedPlatform || !rawUrl) return null;

    const drmScheme = String(media.drmScheme || '').toLowerCase();
    const drm =
      DRM_SCHEMES.has(drmScheme) && media.drmLicenseUrl
        ? {
            type: drmScheme,
            licenseServer: media.drmLicenseUrl,
            ...(drmScheme === 'fairplay'
              ? {
                  certificateUrl: media.drmCertificateUrl,
                  contentId: media.drmContentId,
                }
              : {}),
          }
        : undefined;

    return {
      uri: rawUrl,
      headers: media.source === 'upload' ? headers : undefined,
      ...(media.mimeType === 'application/vnd.apple.mpegurl' ||
      /\.m3u8(?:\?|$)/i.test(rawUrl)
        ? { type: 'm3u8' }
        : media.mimeType === 'application/dash+xml' ||
            /\.mpd(?:\?|$)/i.test(rawUrl)
          ? { type: 'mpd' }
          : {}),
      ...(drm ? { drm } : {}),
    };
  }, [media, isNativePlayer, unsupportedPlatform, rawUrl, headers]);

  const loadMediaHeaders = useCallback(async (forceRefresh = false) => {
    try {
      const token = await getValidAccessToken({ forceRefresh });
      if (!mountedRef.current) return;
      setHeaders(token ? { Authorization: `Bearer ${token}` } : {});
      setError(null);
      return token;
    } catch (refreshError) {
      if (mountedRef.current) {
        setError(
          refreshError?.message || 'Unable to refresh media authorization.',
        );
      }
      throw refreshError;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    streamRetryRef.current = false;
    refreshingStreamRef.current = false;
    retriesRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

    if (media?.source === 'upload') {
      mediaApi
        .authHeaders()
        .then((nextHeaders) => {
          if (active) {
            setHeaders(nextHeaders);
            setError(null);
          }
        })
        .catch(() => {
          if (active) setHeaders({});
        });
    } else {
      setHeaders({});
    }

    return () => {
      active = false;
    };
  }, [media?.id, media?.source]);

  useEffect(() => {
    const unsubscribe = subscribeAuthEvents((event) => {
      if (
        event.type !== 'session:refreshed' &&
        event.type !== 'session:updated'
      ) {
        return;
      }
      if (mediaRef.current?.source !== 'upload') return;
      loadMediaHeaders(false).catch(() => {});
    });

    return unsubscribe;
  }, [loadMediaHeaders]);

  useEffect(() => {
    setLoaded(false);
    loadedRef.current = false;
    bufferingRef.current = false;
    setBuffering(false);
    setPaused(true);
    lastSeekRef.current = 0;
    hostBufferPauseRef.current = null;
    setError(
      unsupportedPlatform
        ? 'This source is not supported on this platform. Ask the host to choose a compatible MP4, audio or HLS source.'
        : null,
    );
    setPosition(0);
    positionRef.current = 0;
    setDuration((media?.durationMs || 0) / 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.id, unsupportedPlatform]);

  useEffect(() => {
    if (paused) {
      pulse.stopAnimation();
      return undefined;
    }

    if (reduceMotion) {
      pulse.setValue(0.7);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [paused, pulse, reduceMotion]);

  const seekTo = useCallback(
    (positionMs, toleranceMs = 180) => {
      if (!loadedRef.current || !Number.isFinite(positionMs)) return;

      const seconds = Math.max(0, positionMs / 1000);
      if (Math.abs(positionRef.current - seconds) * 1000 < toleranceMs) {
        return;
      }

      if (isNativePlayer) {
        if (!videoRef.current) return;
        videoRef.current.seek(seconds);
      } else {
        sendWebCommand('seek', seconds);
      }

      lastSeekRef.current = Date.now();
      positionRef.current = seconds;
      setPosition(seconds);
      onPosition?.(seconds);
    },
    [isNativePlayer, onPosition, sendWebCommand],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekTo,
      getPositionMs: () => Math.round(positionRef.current * 1000),
      enterFullscreen: () => {
        if (videoRef.current?.presentFullscreenPlayer) {
          videoRef.current.presentFullscreenPlayer();
        }
      },
    }),
    [seekTo],
  );

  // Sync play/pause/rate state to WebView players (YouTube + Universal Web)
  useEffect(() => {
    if (isNativePlayer || !loaded) return;
    sendWebCommand(paused ? 'pause' : 'play');
  }, [isNativePlayer, loaded, paused, sendWebCommand]);

  useEffect(() => {
    if (isNativePlayer || !loaded) return;
    sendWebCommand('rate', rate);
  }, [isNativePlayer, loaded, rate, sendWebCommand]);

  const applyExpectedPosition = useCallback(
    (force = false) => {
      if (!loadedRef.current || bufferingRef.current) return;
      const currentPlayback = playbackRef.current;

      const durationMs =
        currentPlayback?.durationMs ||
        mediaRef.current?.durationMs ||
        duration * 1000;

      const targetMs = expectedPosition(
        currentPlayback,
        serverNow(),
        durationMs,
      );

      const currentMs = positionRef.current * 1000;

      const correction = decideCorrection({
        currentPositionMs: currentMs,
        targetPositionMs: targetMs,
        playing: currentPlayback?.status === 'playing',
        rate: currentPlayback?.rate || 1,
      });

      if (force || correction.type === 'seek') {
        if (!force && Date.now() - lastSeekRef.current < 5000) return;
        seekTo(targetMs, 120);
        setRate(currentPlayback?.rate || 1);
        setSynchronizing(true);
        return;
      }

      if (
        correction.type === 'rate' &&
        currentPlayback?.status === 'playing' &&
        !isHost
      ) {
        setRate(correction.rate);
        setSynchronizing(true);
        return;
      }

      setSynchronizing(false);
      setRate(currentPlayback?.rate || 1);
    },
    [duration, isHost, seekTo, serverNow],
  );

  useEffect(() => {
    if (!playback || !media || !loaded) {
      setPaused(true);
      return;
    }

    const mediaChanged = String(playback.mediaId) !== String(media.id);
    if (mediaChanged) return;

    if (playback.status === 'playing') {
      const startsAt = Number(playback.startAtServerMs) || 0;
      const delay = Math.max(0, startsAt - serverNow());
      if (delay > 0) {
        setPaused(true);
        const timer = setTimeout(() => {
          setPaused(false);
          applyExpectedPosition(true);
        }, Math.min(delay, 3000));
        return () => clearTimeout(timer);
      }
      setPaused(false);
    } else if (playback.status === 'paused' || playback.status === 'idle') {
      setPaused(true);
      setRate(playback.rate || 1);
      seekTo(playback.computedPositionMs ?? playback.positionMs, 350);
    } else if (playback.status === 'ended') {
      setPaused(true);
      setRate(playback.rate || 1);
      seekTo(playback.durationMs || playback.positionMs, 350);
    }
  }, [applyExpectedPosition, loaded, media, playback, seekTo, serverNow]);

  useEffect(() => {
    if (
      isHost ||
      !loaded ||
      buffering ||
      !playback ||
      playback.status !== 'playing'
    ) {
      return undefined;
    }

    const timer = setInterval(
      () => applyExpectedPosition(false),
      synchronizing ? 1200 : 3000,
    );

    return () => clearInterval(timer);
  }, [applyExpectedPosition, buffering, isHost, loaded, playback, synchronizing]);

  useEffect(() => {
    if (!isHost || playback?.status !== 'playing') {
      return undefined;
    }

    const timer = setInterval(() => {
      if (loadedRef.current && !bufferingRef.current && positionRef.current > 0) {
        reportPosition?.(positionRef.current * 1000);
      }
    }, HOST_HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isHost, playback?.status, reportPosition]);

  const onLoad = useCallback(
    (event) => {
      setLoaded(true);
      loadedRef.current = true;
      bufferingRef.current = false;
      setBuffering(false);
      setError(null);

      streamRetryRef.current = false;
      retriesRef.current = 0;

      const nextDuration =
        event?.duration > 0
          ? event.duration
          : (media?.durationMs || 0) / 1000;

      if (nextDuration > 0) {
        setDuration(nextDuration);
        onDuration?.(Math.round(nextDuration * 1000));
      }

      if (playbackRef.current?.status === 'playing') {
        applyExpectedPosition(true);
      } else {
        seekTo(
          playbackRef.current?.computedPositionMs ??
            playbackRef.current?.positionMs ??
            0,
          260,
        );
      }
    },
    [applyExpectedPosition, media?.durationMs, onDuration, seekTo],
  );

  const onProgress = useCallback(
    (event) => {
      positionRef.current = event.currentTime;
      setPosition(event.currentTime);
      onPosition?.(event.currentTime);
    },
    [onPosition],
  );

  const onEnd = useCallback(() => {
    setPaused(true);

    if (isHost) {
      onCommand
        ?.('ended', {
          positionMs: Math.round(duration * 1000),
        })
        .catch(() => {});
    }
  }, [duration, isHost, onCommand]);

  const onVideoError = useCallback(
    async (event) => {
      const description =
        event?.error?.errorString ||
        event?.error?.localizedDescription ||
        'This media could not be played on this device.';

      setBuffering(false);
      bufferingRef.current = false;
      loadedRef.current = false;
      setLoaded(false);

      if (
        mediaRef.current?.source === 'upload' &&
        /401|unauthori[sz]ed|expired|forbidden/i.test(description) &&
        !streamRetryRef.current &&
        !refreshingStreamRef.current
      ) {
        refreshingStreamRef.current = true;
        streamRetryRef.current = true;

        try {
          await loadMediaHeaders(true);
          if (mountedRef.current) {
            setLoaded(false);
            setError(null);
            setBuffering(true);
          }
          return;
        } catch {
          // Show original playback error below.
        } finally {
          refreshingStreamRef.current = false;
        }
      }

      setError(description);
    },
    [loadMediaHeaders],
  );

  const retryPlayback = useCallback(() => {
    if (unsupportedPlatform) return;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    setError(null);
    loadedRef.current = false;
    bufferingRef.current = false;
    setLoaded(false);
    setBuffering(false);
    setPaused(true);
    setRetryVersion((version) => version + 1);
  }, [unsupportedPlatform]);

  useEffect(() => {
    if (!media || loaded || error || isWebEmbed) return undefined;
    const timer = setTimeout(() => {
      setError('Media took too long to load. Check the source or connection, then retry.');
      setPaused(true);
    }, 25000);
    return () => clearTimeout(timer);
  }, [error, isWebEmbed, loaded, media, retryVersion]);

  useEffect(() => {
    if (!buffering || error) return undefined;
    const timer = setTimeout(() => {
      setError('Playback stalled. Check your connection, then retry.');
      setPaused(true);
    }, 30000);
    return () => clearTimeout(timer);
  }, [buffering, error]);

  useEffect(() => {
    if (
      !error ||
      !/network|timeout|timed out|connect|load|stall|503|502|504/i.test(error) ||
      retriesRef.current >= 3
    ) {
      return undefined;
    }
    retriesRef.current += 1;
    retryTimerRef.current = setTimeout(
      retryPlayback,
      Math.min(8000, 1000 * 2 ** retriesRef.current) *
        (0.75 + Math.random() * 0.5),
    );
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [error, retryPlayback]);

  const onBuffer = useCallback(
    ({ isBuffering }) => {
      bufferingRef.current = Boolean(isBuffering);
      setBuffering(Boolean(isBuffering));
      if (isHost && loadedRef.current && onCommand) {
        if (
          isBuffering &&
          playbackRef.current?.status === 'playing' &&
          !hostBufferPauseRef.current
        ) {
          hostBufferPauseRef.current = onCommand('pause', {
            positionMs: Math.round(positionRef.current * 1000),
          }).catch(() => null);
        } else if (!isBuffering && hostBufferPauseRef.current) {
          const pending = hostBufferPauseRef.current;
          pending.then((pausedState) => {
            if (hostBufferPauseRef.current !== pending) return;
            hostBufferPauseRef.current = null;
            if (
              pausedState &&
              !bufferingRef.current &&
              mountedRef.current &&
              Number(playbackRef.current?.sequence) <=
                Number(pausedState.sequence)
            ) {
              onCommand('play').catch(() => {});
            }
          });
        }
      }
      if (!isBuffering && loadedRef.current && !isHost) {
        applyExpectedPosition(false);
      }
    },
    [applyExpectedPosition, isHost, onCommand],
  );

  const onWebMessage = useCallback(
    (event) => {
      try {
        const msg = JSON.parse(event?.nativeEvent?.data || '{}');
        if (msg.type === 'loaded') {
          onLoad({ duration: Number(msg.duration) || 0 });
        } else if (msg.type === 'progress') {
          if (Number(msg.duration) > 0 && duration <= 0) {
            setDuration(Number(msg.duration));
            onDuration?.(Math.round(Number(msg.duration) * 1000));
          }
          onProgress({ currentTime: Number(msg.currentTime) || 0 });
        } else if (msg.type === 'buffer') {
          onBuffer({ isBuffering: Boolean(msg.isBuffering) });
        } else if (msg.type === 'ended') {
          onEnd();
        } else if (msg.type === 'error') {
          setError(msg.message || 'Embedded player failed to load this link.');
        }
      } catch {
        // Ignore non-JSON messages from third-party webpages
      }
    },
    [duration, onBuffer, onDuration, onEnd, onLoad, onProgress],
  );

  const playbackLabel = error
    ? 'FAILED'
    : !loaded
      ? 'LOADING'
      : buffering
        ? 'BUFFERING'
        : connectionState !== 'connected'
          ? 'RECONNECTING'
          : synchronizing
            ? 'SYNCHRONIZING'
            : paused
              ? 'PAUSED'
              : 'PLAYING';

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const drmProtected = Boolean(media?.drmScheme);

  if (!media) {
    return (
      <View style={[styles.empty, style]}>
        <View style={styles.emptyArt}>
          <Icon name="music" size={30} color={colors.textFaint} />
        </View>

        <AppText variant="body" color={colors.textMuted}>
          The host has not selected anything yet
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {isYouTube && youtubeVideoId ? (
        <WebView
          key={`${media.id}:yt:${retryVersion}`}
          ref={webViewRef}
          source={{
            html: buildYouTubeHtml(youtubeVideoId),
            baseUrl: 'https://www.youtube.com',
          }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          originWhitelist={['*']}
          onMessage={onWebMessage}
          onError={() =>
            setError('Could not load YouTube player. Check internet and retry.')
          }
        />
      ) : isWebEmbed && rawUrl ? (
        <WebView
          key={`${media.id}:web:${retryVersion}`}
          ref={webViewRef}
          source={{ uri: rawUrl }}
          style={StyleSheet.absoluteFill}
          userAgent={DESKTOP_MOBILE_UA}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          mixedContentMode="always"
          originWhitelist={['*']}
          injectedJavaScript={UNIVERSAL_WEB_INJECTED_JS}
          onLoadEnd={() => {
            if (!loadedRef.current) {
              onLoad({ duration: (media?.durationMs || 0) / 1000 });
            }
          }}
          onMessage={onWebMessage}
          onError={() =>
            setError('Could not load this webpage. Check the link and retry.')
          }
        />
      ) : isVideo ? (
        <>
          {source ? (
            <Video
              key={`${media.id}:${retryVersion}`}
              ref={videoRef}
              source={source}
              style={StyleSheet.absoluteFill}
              paused={paused}
              rate={rate}
              volume={1}
              muted={false}
              resizeMode="contain"
              repeat={false}
              playInBackground={false}
              playWhenInactive={false}
              ignoreSilentSwitch="ignore"
              progressUpdateInterval={400}
              automaticallyWaitsToMinimizeStalling
              {...(Platform.OS === 'android'
                ? {
                    bufferConfig: {
                      minBufferMs: 5000,
                      maxBufferMs: 20000,
                      bufferForPlaybackMs: 1000,
                      bufferForPlaybackAfterRebufferMs: 2000,
                      maxHeapAllocationPercent: 0.2,
                    },
                  }
                : { preferredForwardBufferDuration: 5 })}
              onLoad={onLoad}
              onProgress={onProgress}
              onEnd={onEnd}
              onError={onVideoError}
              onBuffer={onBuffer}
              {...(Platform.OS === 'android' ? { disableFocus: false } : {})}
            />
          ) : null}
        </>
      ) : (
        <>
          {source ? (
            <Video
              key={`${media.id}:${retryVersion}`}
              ref={videoRef}
              source={source}
              style={styles.hiddenVideo}
              paused={paused}
              rate={rate}
              volume={1}
              repeat={false}
              playInBackground={false}
              playWhenInactive={false}
              ignoreSilentSwitch="ignore"
              progressUpdateInterval={400}
              automaticallyWaitsToMinimizeStalling
              {...(Platform.OS === 'android'
                ? {
                    bufferConfig: {
                      minBufferMs: 5000,
                      maxBufferMs: 20000,
                      bufferForPlaybackMs: 1000,
                      bufferForPlaybackAfterRebufferMs: 2000,
                      maxHeapAllocationPercent: 0.2,
                    },
                  }
                : { preferredForwardBufferDuration: 5 })}
              onLoad={onLoad}
              onProgress={onProgress}
              onEnd={onEnd}
              onError={onVideoError}
              onBuffer={onBuffer}
            />
          ) : null}

          <View style={styles.audioArt}>
            <View style={styles.audioDisc}>
              <Animated.View
                style={[styles.audioGlow, { opacity: pulse }]}
              />

              <Waveform
                width={128}
                height={46}
                color={colors.orange}
                bars={24}
              />

              <AppText
                variant="micro"
                color={colors.textFaint}
                style={styles.audioLabel}
              >
                {playbackLabel}
                {isHost && playbackLabel === 'PLAYING' ? ' · HOST' : ''}
              </AppText>
            </View>
          </View>
        </>
      )}

      {(!loaded || buffering || synchronizing) && !error && !isWebEmbed ? (
        <View style={styles.centerOverlay} pointerEvents="none">
          <AppText variant="caption" color={colors.textMuted}>
            {playbackLabel.toLowerCase()}…
          </AppText>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorOverlay}>
          <Icon name="headphonesOff" size={24} color={colors.orange} />

          <AppText
            variant="caption"
            color={colors.offWhite}
            style={styles.errorText}
          >
            {error}
          </AppText>
          <Pressable
            onPress={retryPlayback}
            accessibilityRole="button"
            accessibilityLabel="Retry playback"
            style={{ padding: 12 }}
          >
            <AppText variant="label" color={colors.orange}>
              Retry playback
            </AppText>
          </Pressable>

          {drmProtected ? (
            <AppText
              variant="micro"
              color={colors.textMuted}
              style={styles.drmText}
            >
              {String(media.drmScheme).toUpperCase()} CONTENT · PROVIDER LICENSE
              REQUIRED
            </AppText>
          ) : null}
        </View>
      ) : null}

      {drmProtected && !error ? (
        <View style={styles.drmBadge} pointerEvents="none">
          <Icon name="shield" size={12} color={colors.yellow} />

          <AppText variant="micro" color={colors.yellow}>
            {String(media.drmScheme).toUpperCase()}
          </AppText>
        </View>
      ) : null}

      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
});

export default SyncedMediaPlayer;

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    aspectRatio: 16 / 10,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  hiddenVideo: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
  },

  audioArt: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },

  audioDisc: {
    width: '76%',
    aspectRatio: 1,
    maxWidth: 240,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  audioGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.orangeSoft,
  },

  audioLabel: {
    position: 'absolute',
    bottom: '17%',
    letterSpacing: 1.5,
  },

  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },

  errorText: {
    textAlign: 'center',
    maxWidth: 300,
  },

  drmText: {
    textAlign: 'center',
    marginTop: 4,
  },

  drmBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: 'rgba(255,193,35,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },

  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'rgba(241,243,245,0.10)',
  },

  progressFill: {
    height: 2,
    backgroundColor: colors.orange,
  },

  empty: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    aspectRatio: 16 / 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },

  emptyArt: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.offWhiteSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
}); 