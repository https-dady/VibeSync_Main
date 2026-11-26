jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../src/config', () => ({ getApiBaseUrl: jest.fn(() => 'https://api.example.com') }));
jest.mock('../src/services/storage', () => ({ loadSessionTokens: jest.fn(), saveSessionTokens: jest.fn(), clearSessionTokens: jest.fn() }));
jest.mock('../src/services/authEvents', () => ({ emitAuthEvent: jest.fn() }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tokens = (name = 'old') => ({ accessToken: name, refreshToken: `${name}-refresh`, accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), apiOrigin: 'https://api.example.com' });

describe('secure session lifecycle', () => {
  let session;
  let storage;
  let axios;
  let config;
  beforeEach(() => {
    jest.resetModules();
    session = require('../src/api/session');
    storage = require('../src/services/storage');
    axios = require('axios');
    config = require('../src/config');
    storage.loadSessionTokens.mockResolvedValue(tokens());
    storage.saveSessionTokens.mockResolvedValue(true);
    storage.clearSessionTokens.mockResolvedValue(true);
  });
  test('concurrent boot reads secure storage once', async () => {
    await Promise.all([session.initializeSession(), session.initializeSession()]);
    expect(storage.loadSessionTokens).toHaveBeenCalledTimes(1);
  });
  test('a delayed boot read cannot overwrite a newer login', async () => {
    const load = deferred();
    storage.loadSessionTokens.mockReturnValue(load.promise);
    const boot = session.initializeSession();
    await session.persistSession(tokens('new'));
    load.resolve(tokens('old'));
    await boot;
    expect(session.getSessionSnapshot().accessToken).toBe('new');
  });
  test('refresh responses cannot restore a signed out session', async () => {
    await session.initializeSession();
    const request = deferred();
    axios.post.mockReturnValue(request.promise);
    const refreshing = session.refreshSession();
    const failure = refreshing.catch((error) => error);
    await Promise.resolve();
    await Promise.resolve();
    await session.clearSession();
    request.resolve({ data: tokens('rotated') });
    expect(await failure).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(session.getSessionSnapshot()).toBeNull();
  });
  test('simultaneous refreshes use one rotating token request', async () => {
    await session.initializeSession();
    axios.post.mockResolvedValue({ data: tokens('rotated') });
    const results = await Promise.all([session.refreshSession(), session.refreshSession(), session.refreshSession()]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['rotated', 'rotated', 'rotated']);
  });
  test('never sends an old server token after an origin switch', async () => {
    await session.initializeSession();
    config.getApiBaseUrl.mockReturnValue('https://another.example');
    await expect(session.getValidAccessToken()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(session.getSessionSnapshot()).toBeNull();
  });
  test('legacy credentials without a bound origin require sign-in', async () => {
    const legacy = tokens();
    delete legacy.apiOrigin;
    storage.loadSessionTokens.mockResolvedValue(legacy);
    await expect(session.initializeSession()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(storage.clearSessionTokens).toHaveBeenCalledTimes(1);
  });
  test('secure storage failure does not leave a usable login in memory', async () => {
    storage.saveSessionTokens.mockRejectedValue(new Error('Keychain locked'));
    await expect(session.persistSession(tokens('new'))).rejects.toThrow('Keychain locked');
    expect(session.getSessionSnapshot()).toBeNull();
  });
  test('secure deletion failure is surfaced while in-memory tokens stay cleared', async () => {
    await session.initializeSession();
    storage.clearSessionTokens.mockRejectedValue(new Error('Keychain locked'));
    await expect(session.clearSession()).rejects.toThrow('Keychain locked');
    expect(session.getSessionSnapshot()).toBeNull();
  });
});
