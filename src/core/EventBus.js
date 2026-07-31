// Tiny pub/sub event bus for cross-system signals (§14.0), e.g.
// "checkpointReached" (Amendment 01 §A.4), later "playerEnteredTown",
// "weatherEventStarted". Keeps systems decoupled — SaveManager listens for
// checkpoint signals instead of gameplay code calling save directly.

export class EventBus {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

// Single shared instance — systems import this rather than passing it around.
export const bus = new EventBus();
