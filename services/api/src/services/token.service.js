'use strict';

const { trusted } = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const config = require('../config/env');
const RefreshSession = require('../models/RefreshSession');
const { randomToken, sha256, randomFamilyId } = require('../utils/ids');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const { atomic } = require('../utils/transaction');

const ISSUER = 'vibesync-api';
const AUDIENCE = 'vibesync-mobile';

function signAccessToken(user, familyId) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      type: 'access',
      ver: user.tokenVersion || 0,
      sid: familyId,
    },
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: config.ACCESS_TOKEN_TTL,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
      jwtid: crypto.randomUUID(),
    },
  );
}

async function assertAccessSession(payload, user) {
  if (!user || user.disabledAt || payload.ver !== (user.tokenVersion || 0)) {
    throw ApiError.unauthorized('Your session has been revoked; sign in again', 'SESSION_REVOKED');
  }
  if (!payload.sid || !(await RefreshSession.exists({
    user: user._id, familyId: payload.sid, revokedAt: null, expiresAt: trusted({ $gt: new Date() }),
  }))) throw ApiError.unauthorized('Your session has expired or been revoked', 'SESSION_REVOKED');
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (payload.type !== 'access' || !payload.sub) {
      throw new Error('Wrong token type');
    }
    return payload;
  } catch {
    throw ApiError.unauthorized('Access token is invalid or expired', 'TOKEN_INVALID');
  }
}

function refreshExpiry() {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueRefreshToken(user, { familyId, ip = '', userAgent = '' } = {}) {
  const raw = randomToken(48);
  const tokenHash = sha256(raw);
  const session = await RefreshSession.create({
    user: user._id || user.id,
    tokenHash,
    familyId: familyId || randomFamilyId(),
    expiresAt: refreshExpiry(),
    ip,
    userAgent: userAgent.slice(0, 300),
  });
  return { raw, session };
}

function accessExpiry(accessToken) {
  const decoded = jwt.decode(accessToken);
  return decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null;
}

async function issueTokenPair(user, metadata = {}) {
  const refresh = await issueRefreshToken(user, metadata);
  const accessToken = signAccessToken(user, refresh.session.familyId);
  return {
    accessToken,
    accessExpiresAt: accessExpiry(accessToken),
    refreshToken: refresh.raw,
    refreshExpiresAt: refresh.session.expiresAt.toISOString(),
    tokenType: 'Bearer',
  };
}

async function rotateRefreshTokenAtomic(rawToken, metadata = {}) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw ApiError.unauthorized('Refresh token required', 'REFRESH_REQUIRED');
  }
  const tokenHash = sha256(rawToken);
  const session = await RefreshSession.findOne({ tokenHash }).populate('user');

  if (!session) {
    throw ApiError.unauthorized('Refresh token is invalid', 'REFRESH_INVALID');
  }

  // Reuse of a rotated token means the token was stolen. Revoke the whole family.
  if (session.revokedAt) {
    throw ApiError.unauthorized('Refresh token reuse detected; please sign in again', 'REFRESH_REUSE');
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token expired', 'REFRESH_EXPIRED');
  }

  if (!session.user || session.user.disabledAt) {
    throw ApiError.unauthorized('Account unavailable', 'ACCOUNT_DISABLED');
  }

  // Claim the old token before creating its successor. Transaction retries
  // observe revokedAt and cannot mint a second active refresh token.
  session.revokedAt = new Date();
  await session.save();
  const replacement = await issueRefreshToken(session.user, {
    familyId: session.familyId,
    ...metadata,
  });

  session.replacedByHash = sha256(replacement.raw);
  await session.save();

  const accessToken = signAccessToken(session.user, session.familyId);
  return {
    accessToken,
    accessExpiresAt: accessExpiry(accessToken),
    refreshToken: replacement.raw,
    refreshExpiresAt: replacement.session.expiresAt.toISOString(),
    tokenType: 'Bearer',
  };
}

const rotateAtomic = atomic(rotateRefreshTokenAtomic);
async function rotateRefreshToken(rawToken, metadata = {}) {
  try {
    return await rotateAtomic(rawToken, metadata);
  } catch (error) {
    if (error.code === 'REFRESH_REUSE') {
      const session = await RefreshSession.findOne({ tokenHash: sha256(rawToken) });
      if (session) await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    }
    throw error;
  }
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = sha256(rawToken);
  const session = await RefreshSession.findOne({ tokenHash });
  if (session) await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

async function revokeAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await RefreshSession.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

async function pruneSessions(userId, keepHash) {
  const keep = keepHash || crypto.randomBytes(1).toString('hex');
  await RefreshSession.deleteMany({ user: userId, tokenHash: trusted({ $ne: keep }) });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  assertAccessSession,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken: atomic(revokeRefreshToken),
  revokeAllSessions: atomic(revokeAllSessions),
  pruneSessions,
};
