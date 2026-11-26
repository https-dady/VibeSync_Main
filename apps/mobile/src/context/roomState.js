import { shouldApplyState } from '../sync/PlaybackSync';

export function mergePlayback(current, incoming) {
  if (!incoming) return current;
  return shouldApplyState(current?.sequence, incoming.sequence) ? incoming : current;
}

export function mergeMessages(existing = [], incoming = []) {
  const map = new Map();
  for (const message of [...existing, ...(Array.isArray(incoming) ? incoming : [incoming])]) {
    if (!message?.id) continue;
    const id = String(message.id);
    const previous = map.get(id);
    // Deleted messages must never be resurrected by delayed acknowledgement.
    map.set(id, previous?.deleted ? previous : { ...previous, ...message });
  }
  const confirmedKeys = new Set([...map.values()]
    .filter((message) => message.delivery === 'sent' && message.clientMessageId)
    .map((message) => `${message.senderId}:${message.clientMessageId}`));
  return [...map.values()].filter((message) => !message.optimistic ||
    !confirmedKeys.has(`${message.senderId}:${message.clientMessageId}`)).sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || String(a.id).localeCompare(String(b.id)));
}

export function createMessageId() {
  // Randomness is for collision avoidance, never authentication.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
