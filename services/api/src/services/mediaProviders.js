'use strict';
const net = require('node:net');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (!host.includes('.') && !net.isIP(host))) return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIP(host) === 6) return host === '::' || host === '::1' || /^f[cd]|^fe[89ab]/i.test(host) || host.startsWith('::ffff:');
  return false;
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw ApiError.badRequest('Media URL is not valid', 'INVALID_MEDIA_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw ApiError.badRequest('Use an HTTP(S) URL without embedded credentials', 'INVALID_MEDIA_URL');
  }
  if (isPrivateHost(url.hostname)) {
    throw ApiError.badRequest('Use a public media host; local files belong in Nearby mode', 'PRIVATE_MEDIA_URL');
  }
  if (config.isProduction && url.protocol !== 'https:') {
    throw ApiError.badRequest('Production media URLs must use HTTPS', 'INSECURE_MEDIA_URL');
  }
  const allowed = config.MEDIA_ALLOWED_HOSTS?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean) || [];
  if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) {
    throw ApiError.badRequest('This media host is not enabled by this deployment', 'MEDIA_HOST_NOT_ALLOWED');
  }
  return url;
}

const providers = [
  { id: 'direct-hls', formats: ['m3u8'], mime: ['application/vnd.apple.mpegurl', 'application/x-mpegurl'], platforms: ['android', 'ios'] },
  { id: 'direct-dash', formats: ['mpd'], mime: ['application/dash+xml'], platforms: ['android'] },
  { id: 'direct-audio', formats: ['mp3', 'm4a', 'aac', 'wav', 'flac'], mime: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac'], platforms: ['android', 'ios'] },
  { id: 'direct-video', formats: ['mp4', 'mov', 'm4v'], mime: ['video/mp4', 'video/quicktime'], platforms: ['android', 'ios'] },
  { id: 'direct-android', formats: ['webm', 'mkv', 'ogg', 'ogv'], mime: ['video/webm', 'audio/webm', 'video/x-matroska', 'audio/ogg', 'video/ogg'], platforms: ['android'] },
];

function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase();
  return /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host);
}

function resolveMediaSource(input) {
  const url = validateUrl(input.url);
  const host = url.hostname.toLowerCase();
  const scheme = input.drmScheme || '';

  // 1. YouTube links (watch, youtu.be, shorts, live, embed)
  if (isYouTubeHost(host)) {
    return {
      url: url.toString(),
      provider: 'youtube-embed',
      mimeType: 'text/html',
      playbackCapabilities: {
        providerId: 'youtube-embed',
        supportedPlatforms: ['android', 'ios'],
        authentication: 'public-or-provider-signed-url',
        drmRequired: false,
        synchronizedPlayback: true,
        seeking: true,
        metadataSource: 'user-supplied',
        urlResolution: 'embed',
      },
    };
  }

  // 2. Direct media stream URLs (.mp4, .m3u8, .mpd, .mp3, etc.)
  const extension = url.pathname.split('.').pop().toLowerCase();
  const mime = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
  const directProvider =
    providers.find((item) => item.formats.includes(extension)) ||
    providers.find((item) => item.mime.includes(mime));

  if (directProvider) {
    let platforms = [...directProvider.platforms];
    if (scheme === 'widevine') platforms = platforms.filter((item) => item === 'android');
    if (scheme === 'fairplay') platforms = platforms.filter((item) => item === 'ios');
    if ((scheme && !['widevine', 'fairplay'].includes(scheme)) || !platforms.length) {
      throw ApiError.badRequest('This DRM and stream combination is not supported by the selected native players', 'UNSUPPORTED_DRM');
    }

    return {
      url: url.toString(),
      provider: directProvider.id,
      mimeType: mime || directProvider.mime[0],
      playbackCapabilities: {
        providerId: directProvider.id,
        supportedPlatforms: platforms,
        authentication: 'public-or-provider-signed-url',
        drmRequired: Boolean(scheme),
        synchronizedPlayback: true,
        seeking: true,
        metadataSource: 'user-supplied',
        urlResolution: 'direct',
      },
    };
  }

  // 3. Universal Web Embed (Instagram Reels/Posts, Terabox, Diskwala, Google Drive, etc.)
  return {
    url: url.toString(),
    provider: 'web-embed',
    mimeType: 'text/html',
    playbackCapabilities: {
      providerId: 'web-embed',
      supportedPlatforms: ['android', 'ios'],
      authentication: 'public-or-provider-signed-url',
      drmRequired: false,
      synchronizedPlayback: true,
      seeking: true,
      metadataSource: 'user-supplied',
      urlResolution: 'embed',
    },
  };
}

module.exports = { providers, validateUrl, resolveMediaSource, isPrivateHost };