// Checkpoint-only save system (Amendment 01 §A). No free-form saving:
// snapshots fire ONLY from the "checkpointReached" EventBus signal, emitted by
// Checkpoint.js markers (mid-stretch) or, in Phase 7+, BiomeManager on city
// entry. One rolling slot (§A.4); loading always resumes at the most recent
// checkpoint reached.
//
// Snapshot schema is versioned so later phases (inventory, skills, class,
// companions, mount, worldFlags) extend it without breaking old saves.

import { bus } from './EventBus.js';
import { encodeSnapshot, decodeSnapshot, peekBiomeIndex } from './SaveCodeCodec.js';

const KEY = 'eastward.save';
const SCHEMA_VERSION = 1;

export class SaveManager {
  constructor(player) {
    this.player = player;
    this.lastCheckpointId = null;
    this.biomeId = 'meadow';
    this.getWorldState = null;   // main provides () => ({ timeOfDay, ... })

    // '?new' in the URL starts a fresh journey (clears the rolling slot)
    if (new URLSearchParams(location.search).has('new')) {
      localStorage.removeItem(KEY);
    }

    bus.on('checkpointReached', ({ id }) => this.saveAtCheckpoint(id));
    bus.on('forceSave', ({ id }) => { this.lastCheckpointId = null; this.saveAtCheckpoint(id); });
  }

  setBiome(id) { this.biomeId = id; }

  saveAtCheckpoint(checkpointId) {
    if (checkpointId === this.lastCheckpointId) return; // no re-fire on linger
    this.lastCheckpointId = checkpointId;

    const snapshot = {
      version: SCHEMA_VERSION,
      checkpointId,
      biome: this.biomeId,
      world: this.getWorldState?.() ?? {},
      savedAt: Date.now(),
      player: {
        x: this.player.x,
        facing: this.player.facing,
        stamina: this.player.stamina,
        endurance: this.player.endurance,
        artifacts: this.player.artifacts,
        identified: this.player.identified,
        gold: this.player.gold,
        classId: this.player.classId,
        health: this.player.health,
        mana: this.player.mana,
        maxHealth: this.player.maxHealth,
        skills: { ...this.player.skills, climbSkill: this.player.climbSkill },
        xp: this.player.xp,
        level: this.player.level,
        ageDays: this.player.ageDays,
        injuries: this.player.injuries.map(i => i.kind),
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
    player.artifacts = snap.player.artifacts ?? 0;
    player.identified = snap.player.identified ?? 0;
    player.gold = snap.player.gold ?? 0;
    if (snap.player.health != null) player.health = snap.player.health;
    if (snap.player.mana != null) player.mana = snap.player.mana;
    if (snap.player.maxHealth != null) player.maxHealth = snap.player.maxHealth;
    if (snap.player.skills) {
      player.skills.accuracy = snap.player.skills.accuracy ?? 1;
      player.skills.fightSpeed = snap.player.skills.fightSpeed ?? 1;
      player.skills.autoDodge = snap.player.skills.autoDodge ?? 0;
      if (snap.player.skills.climbSkill != null) player.climbSkill = snap.player.skills.climbSkill;
    }
    player.xp = snap.player.xp ?? 0;
    player.level = snap.player.level ?? 0;
    player.ageDays = snap.player.ageDays ?? 0;
    player.injuries = (snap.player.injuries ?? []).map(k => ({ kind: k, t: 90 }));
  }

  /** Amendment 07 §S: export the CURRENT local checkpoint save as a code. */
  exportCode(biome, manifest) {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try { return encodeSnapshot(JSON.parse(raw), biome, manifest); }
    catch { return null; }
  }

  peekCodeBiome(code, manifest) {
    const idx = peekBiomeIndex(code);
    return idx == null ? null : manifest.biomes[idx] ?? null;
  }

  /** Decode + overwrite the rolling local slot (§S.3). Returns snapshot or null. */
  importFromCode(code, biome, manifest) {
    const snap = decodeSnapshot(code, biome, manifest);
    if (!snap) return null;
    localStorage.setItem(KEY, JSON.stringify(snap));
    this.lastCheckpointId = snap.checkpointId;
    this.biomeId = snap.biome;
    return snap;
  }

  _migrate(snap) {
    // Future schema versions handle upgrades here; unknown = start fresh.
    return null;
  }
}
