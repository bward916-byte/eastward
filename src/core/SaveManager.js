// Checkpoint-only save system (Amendment 01 §A). No free-form saving:
// snapshots fire ONLY from the "checkpointReached" EventBus signal, emitted by
// Checkpoint.js markers (mid-stretch) or, in Phase 7+, BiomeManager on city
// entry. One rolling slot (§A.4); loading always resumes at the most recent
// checkpoint reached.
//
// Snapshot schema is versioned so later phases (inventory, skills, class,
// companions, mount, worldFlags) extend it without breaking old saves.

import { bus } from './EventBus.js';

const KEY = 'eastward.save';
const SCHEMA_VERSION = 1;

export class SaveManager {
  constructor(player) {
    this.player = player;
    this.lastCheckpointId = null;

    // '?new' in the URL starts a fresh journey (clears the rolling slot)
    if (new URLSearchParams(location.search).has('new')) {
      localStorage.removeItem(KEY);
    }

    bus.on('checkpointReached', ({ id }) => this.saveAtCheckpoint(id));
  }

  saveAtCheckpoint(checkpointId) {
    if (checkpointId === this.lastCheckpointId) return; // no re-fire on linger
    this.lastCheckpointId = checkpointId;

    const snapshot = {
      version: SCHEMA_VERSION,
      checkpointId,
      savedAt: Date.now(),
      player: {
        x: this.player.x,
        facing: this.player.facing,
        stamina: this.player.stamina,
        endurance: this.player.endurance,
      },
      // Reserved for later phases (schema stability — Amendment 01 §A.4):
      // health/injuries/sickness (§12), inventory, equipment, skills, class,
      // ageTime, companions, mount, worldFlags
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      bus.emit('gameSaved', { checkpointId });
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  /** Returns the snapshot to resume from, or null for a fresh journey. */
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (snap.version !== SCHEMA_VERSION) return this._migrate(snap);
      this.lastCheckpointId = snap.checkpointId;
      return snap;
    } catch {
      return null;
    }
  }

  applyTo(player, snap) {
    player.x = snap.player.x;
    player.prevX = snap.player.x;
    player.facing = snap.player.facing ?? 1;
    player.stamina = snap.player.stamina ?? 100;
    player.endurance = snap.player.endurance ?? 100;
  }

  _migrate(snap) {
    // Future schema versions handle upgrades here; unknown = start fresh.
    return null;
  }
}
