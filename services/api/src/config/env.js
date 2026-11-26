'use strict';

const path = require('node:path');
const { z } = require('zod');

// Load services/api/.env for local development. Existing process environment
// variables win, so Docker, systemd, and the test setup remain authoritative.
require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
  quiet: true,
});

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? def : value === 'true' || value === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:4000'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/vibesync'),
  REDIS_URL: z.string().optional().or(z.literal('')),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
  ACCESS_TOKEN_TTL: z.string().regex(/^\d+(s|m|h|d)$/).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: bool(false),
  MEDIA_STORAGE_DIR: z.string().default(path.join(process.cwd(), 'storage', 'uploads')),
  MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool(false),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(['', 'AES256', 'aws:kms']).default(''),
  MEDIA_ALLOWED_HOSTS: z.string().default(''),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(500),
  STUN_URLS: z
    .string()
    .default('stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'),
  TURN_URL: z.string().optional().or(z.literal('')),
  TURN_USERNAME: z.string().optional().or(z.literal('')),
  TURN_CREDENTIAL: z.string().optional().or(z.literal('')),
  TURN_SECRET: z.string().optional().or(z.literal('')),
  TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  LIVEKIT_URL: z.string().optional().or(z.literal('')),
  LIVEKIT_API_KEY: z.string().optional().or(z.literal('')),
  LIVEKIT_API_SECRET: z.string().optional().or(z.literal('')),
  LOG_LEVEL: z.string().default(isTest ? 'silent' : 'info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

if (isProduction) {
  const unsafe = [];
  const placeholderAccessSecrets = new Set([
    'dev-access-secret-change-me',
    'replace-with-a-long-random-access-secret',
  ]);
  const placeholderRefreshSecrets = new Set([
    'dev-refresh-secret-change-me',
    'replace-with-a-long-random-refresh-secret',
  ]);
  if (placeholderAccessSecrets.has(raw.JWT_ACCESS_SECRET)) unsafe.push('JWT_ACCESS_SECRET');
  if (placeholderRefreshSecrets.has(raw.JWT_REFRESH_SECRET)) unsafe.push('JWT_REFRESH_SECRET');
  if (raw.JWT_ACCESS_SECRET.length < 32 || /replace|example|change-me/i.test(raw.JWT_ACCESS_SECRET)) unsafe.push('JWT_ACCESS_SECRET must be random and at least 32 characters');
  if (raw.JWT_REFRESH_SECRET.length < 32 || /replace|example|change-me/i.test(raw.JWT_REFRESH_SECRET)) unsafe.push('JWT_REFRESH_SECRET must be random and at least 32 characters');
  if (raw.JWT_ACCESS_SECRET === raw.JWT_REFRESH_SECRET) unsafe.push('Access and refresh secrets must differ');
  if (raw.CORS_ORIGINS === '*' || !raw.CORS_ORIGINS.trim()) unsafe.push('CORS_ORIGINS must name trusted origins');
  if (!raw.API_PUBLIC_URL.startsWith('https://') || !raw.PUBLIC_WEB_URL.startsWith('https://')) unsafe.push('Public API/web URLs must use HTTPS');
  if (raw.MEDIA_STORAGE_DRIVER === 's3' && (!raw.S3_BUCKET || raw.S3_ENDPOINT && !raw.S3_ENDPOINT.startsWith('https://'))) unsafe.push('S3 requires a private bucket and HTTPS endpoint');
  if (unsafe.length) {
    // eslint-disable-next-line no-console
    console.error(`Refusing to start in production with default secrets: ${unsafe.join(', ')}`);
    process.exit(1);
  }
}

const config = {
  ...raw,
  isProduction,
  isTest,
  corsOrigins:
    raw.CORS_ORIGINS === '*'
      ? '*'
      : raw.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  stunUrls: raw.STUN_URLS.split(',').map((url) => url.trim()).filter(Boolean),
  uploadMaxBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  livekitEnabled: Boolean(raw.LIVEKIT_URL && raw.LIVEKIT_API_KEY && raw.LIVEKIT_API_SECRET),
  roomIdAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
};

module.exports = config;
