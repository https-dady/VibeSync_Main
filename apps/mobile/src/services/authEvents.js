const listeners = new Set();

export function subscribeAuthEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAuthEvent(event) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A listener must not break the auth machinery.
    }
  });
}
