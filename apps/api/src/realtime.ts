/**
 * In-process realtime bus (SSE fan-out).
 * A multi-node deployment replaces this with Redis pub/sub — the interface stays the same.
 */

type Listener = (event: { type: string; data: unknown }) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(userId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(userId);
  };
}

export function publish(userId: string, event: { type: string; data: unknown }): void {
  const set = listeners.get(userId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A broken stream must never break the request path.
    }
  }
}

export function subscriberCount(): number {
  return listeners.size;
}
