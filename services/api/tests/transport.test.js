'use strict';
const { byteRange } = require('../src/services/mediaStorage');
const presence = require('../src/services/presence.service');
const { hashPassword, verifyPassword } = require('../src/services/password.service');
test('long Unicode passwords cannot authenticate using bcrypt-truncated suffixes', async () => {
  const prefix = 'StrongPassword1' + 'é'.repeat(40);
  const hash = await hashPassword(prefix + 'A');
  expect(await verifyPassword(prefix + 'A', hash)).toBe(true);
  expect(await verifyPassword(prefix + 'B', hash)).toBe(false);
});
test.each([
  ['bytes=0-3', 10, { start: 0, end: 3 }], ['bytes=3-', 10, { start: 3, end: 9 }],
  ['bytes=-4', 10, { start: 6, end: 9 }], ['bytes=0-99', 10, { start: 0, end: 9 }],
  ['bytes=10-11', 10, false], ['bytes=3-1', 10, false], ['bytes=-0', 10, false],
  ['bytes=0-1,3-4', 10, false], ['bytes=9007199254740992-', 10, false],
])('Range %s enforces safe byte bounds', (header, size, expected) => expect(byteRange(header, size)).toEqual(expected));
test('presence handles two independent sockets without false offline transitions', async () => {
  expect(await presence.markOnline('PRES123', 'user1', 'socket1')).toBe(true);
  expect(await presence.markOnline('PRES123', 'user1', 'socket2')).toBe(false);
  expect(await presence.markOffline('PRES123', 'user1', 'socket1')).toBe(false);
  expect(await presence.onlineUsers('PRES123')).toEqual(['user1']);
  expect(await presence.markOffline('PRES123', 'user1', 'socket2')).toBe(true);
  expect(await presence.onlineUsers('PRES123')).toEqual([]);
});
test('one active socket heartbeat does not preserve a crashed socket forever', async () => {
  let now = 100000; const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    await presence.markOnline('TTL1234', 'user2', 'crashed'); await presence.markOnline('TTL1234', 'user2', 'active');
    now += 50000; await presence.touchPresence('TTL1234', 'user2', 'active'); now += 50000;
    expect(await presence.markOffline('TTL1234', 'user2', 'active')).toBe(true);
  } finally { spy.mockRestore(); }
});
