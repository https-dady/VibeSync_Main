'use strict';
// Real HTTP/Socket.IO/MongoDB loopback benchmark. This does not emulate players,
// radio transport, device speakers, battery use or internet packet loss.
const path = require('node:path');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const projectArg = process.argv.indexOf('--project');
const apiRoot = projectArg >= 0 ? path.resolve(process.argv[projectArg + 1]) : path.resolve(__dirname, '..');
require(path.join(apiRoot, 'tests/setup-env'));
const server = require(path.join(apiRoot, 'tests/testServer'));
const samples = {};
const sockets = [];
const capacity = [];
let bytes = 0;

function observe(name, ms) { (samples[name] ||= []).push(ms); }
async function measure(name, operation) {
  const start = performance.now();
  const result = await operation();
  observe(name, performance.now() - start);
  if (result?.body) bytes += Buffer.byteLength(JSON.stringify(result.body));
  return result;
}
function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] * 100) / 100;
  return { count: values.length, p50_ms: at(0.5), p95_ms: at(0.95), min_ms: at(0), max_ms: at(1) };
}
async function connect(token) {
  const socket = server.connectSocket(token);
  sockets.push(socket);
  await server.waitFor(socket, 'connect');
  return socket;
}
async function main() {
  const cpu = process.cpuUsage();
  const wall = performance.now();
  try {
    await server.startTestServer();
    const accounts = [];
    for (let index = 0; index < 20; index += 1) {
      accounts.push(await measure('registration', () => server.register(`Bench ${index}`, `bench${index}@example.com`)));
    }
    for (let index = 0; index < 8; index += 1) {
      await measure('login', () => server.request(server.app).post('/api/auth/login').send({ email: `bench${index}@example.com`, password: 'Password123' }).expect(200));
    }
    const host = accounts[0];
    const peers = await Promise.all(accounts.map((account) => connect(account.accessToken)));
    for (const count of [2, 5, 10, 20]) {
      const created = await measure('room_create', () => server.request(server.app).post('/api/rooms').set(server.authed(host.accessToken)).send({ name: `Bench ${count}`, maxParticipants: 50, chatRateLimitPerMinute: 60 }).expect(201));
      const code = created.body.room.roomId;
      await server.emitAck(peers[0], 'room:join', { roomId: code });
      await Promise.all(accounts.slice(1, count).map((account, index) => measure(`join_${count}_clients`, async () => {
        await server.request(server.app).post(`/api/rooms/${code.toLowerCase()}/join`).set(server.authed(account.accessToken)).send({}).expect(200);
        const result = await server.emitAck(peers[index + 1], 'room:join', { roomId: code });
        if (!result.ok) throw new Error(result.error?.message || 'Subscription failed');
        return result;
      })));
      const room = await server.request(server.app).get(`/api/rooms/${code}`).set(server.authed(host.accessToken)).expect(200);
      capacity.push({ simulated_clients: count, reported_members: room.body.room.memberCount, membership_consistent: room.body.room.memberCount === count });
      for (let index = 0; index < 5; index += 1) {
        const delivered = server.waitFor(peers[1], 'chat:message');
        const started = performance.now();
        const ack = await server.emitAck(peers[0], 'chat:send', { roomId: code, body: `Benchmark ${index}`, clientMessageId: `bench_${count}_${index}` });
        if (!ack.ok) throw new Error(ack.error?.message || 'Chat failed');
        await delivered;
        observe(`chat_${count}_clients`, performance.now() - started);
      }
      const leave = peers[1];
      leave.disconnect();
      const reconnected = server.waitFor(leave, 'connect');
      const started = performance.now();
      leave.connect();
      await reconnected;
      const subscribed = await server.emitAck(leave, 'room:join', { roomId: code });
      if (!subscribed.ok) throw new Error('Reconnect subscription failed');
      observe('socket_reconnect', performance.now() - started);
    }
    for (let index = 0; index < 10; index += 1) {
      await measure('clock_roundtrip', () => server.emitAck(peers[0], 'clock:sync', { t0: Date.now() }));
    }
    const used = process.cpuUsage(cpu);
    const output = {
      measured_at: new Date().toISOString(), node: process.version,
      environment: 'Windows loopback Node API + independent Socket.IO clients + ephemeral MongoDB; Redis disabled; rate limits disabled by test environment',
      duration_ms: Math.round(performance.now() - wall),
      metrics: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, statistics(values)])),
      capacity,
      node_process: { cpu_user_ms: used.user / 1000, cpu_system_ms: used.system / 1000, rss_bytes: process.memoryUsage().rss, heap_used_bytes: process.memoryUsage().heapUsed },
      sampled_response_json_bytes: bytes,
      unverified: ['native startup', 'BLE discovery', 'LAN/hotspot media transfer', 'decoder startup/buffering', 'acoustic playback drift', 'packet loss', 'OS network bytes', 'battery', 'physical participant capacity'],
    };
    const outputArg = process.argv.indexOf('--output');
    if (outputArg >= 0) fs.writeFileSync(path.resolve(process.argv[outputArg + 1]), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await server.stopTestServer();
  }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
