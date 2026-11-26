'use strict';
const { connectDatabase, disconnectDatabase, mongoose } = require('../src/config/db');

async function main() {
  await connectDatabase();
  for (const name of ['User', 'RefreshSession', 'Room', 'RoomMember', 'MediaAsset', 'Message', 'SpeakRequest', 'Notification', 'Device']) require(`../src/models/${name}`);
  // Reconcile counters from durable membership. No destructive index removal.
  const Room = mongoose.model('Room');
  const RoomMember = mongoose.model('RoomMember');
  for await (const room of Room.find({ status: 'active' }).cursor()) {
    await mongoose.connection.transaction(async (session) => {
      const active = await RoomMember.countDocuments({ room: room._id, status: 'active' }).session(session);
      await Room.updateOne({ _id: room._id, status: 'active' }, { $set: { memberCount: active } }, { session });
    });
  }
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  // Older builds had a Room expiration TTL. It deletes active room documents
  // without dependent cleanup, so remove that specific obsolete index.
  const indexes = await Room.collection.indexes();
  for (const index of indexes) {
    if ((index.key.expiresAt === 1 || index.key.lastActivityAt === 1) && index.expireAfterSeconds !== undefined) await Room.collection.dropIndex(index.name);
  }
  await disconnectDatabase();
  process.stdout.write('Membership reconciliation and index migration completed.\n');
}
main().catch(async (error) => {
  process.stderr.write(`${error.message}\n`);
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
});
