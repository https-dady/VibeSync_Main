'use strict';

const ApiError = require('../utils/ApiError');
const { verifyAccessToken, assertAccessSession } = require('../services/token.service');
const User = require('../models/User');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Bearer access token required');
    }
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.disabledAt) {
      throw ApiError.unauthorized('Account unavailable', 'ACCOUNT_DISABLED');
    }
    await assertAccessSession(payload, user);
    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return next();
    const payload = verifyAccessToken(header.slice(7));
    req.user = await User.findById(payload.sub);
    await assertAccessSession(payload, req.user);
    return next();
  } catch {
    req.user = null;
    return next();
  }
}

module.exports = { authenticate, optionalAuth };
