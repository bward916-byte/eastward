// Journal — journey-wide memory of decisions (the consequence spine).
//
// EncounterManager.getFlags() only ever knows the CURRENT biome's encounters;
// they are discarded at every transitionTo(). Anything that must outlive the
// biome border — a promise made in the meadow that pays off on the slopes —
// lives here instead. One instance per journey, serialized into the save
// snapshot alongside world.flags.
//
// Two kinds of memory:
//   decisions  id -> choice index   (from adventureResolved / branchChosen)
//   marks      key -> value         (derived state: companion, reputation, debts)
//
// Condition strings (authored in biome JSON as `requires` / `requiresAny`):
//   "mdw-traveler"        encounter resolved at all
//   "mdw-traveler=1"      resolved AND choice index 1 was taken
//   "@corran"             mark exists and is truthy
//   "@corran=saved"       mark equals value
//   "+mira"               that companion is in the party
//   "#party>=3"           party-size threshold (>=, <=, >, < supported)
//   "!mdw-traveler"       negation of any of the above
//
// `requires` is ALL-of; `requiresAny` is ANY-of. Both may be present.

import { bus } from './EventBus.js';

export class Journal {
  constructor() {
    this.decisions = new Map();   // encounterId -> choice index (int)
    this.marks = new Map();       // key -> string|number|boolean
    this._wired = false;
  }

  // Listen for the events that constitute a decision. Called once from main.
  wire() {
    if (this._wired) return;
    this._wired = true;
    bus.on('adventureResolved', ({ id, choice }) => this.record(id, choice));
    bus.on('branchChosen', ({ id, route }) => {
      if (id != null) this.record(id, route ?? 0);
    });
    bus.on('riteCompleted', ({ classId }) => {
      if (classId) this.mark('class', classId);
    });
  }

  record(id, choice = 0) {
    if (!id) return;
    this.decisions.set(id, Number(choice) | 0);
  }

  mark(key, value = true) { if (key) this.marks.set(key, value); }

  // --- party roster ---------------------------------------------------------
  // Stored as one ordered mark ('party') so it rides the existing save path
  // with no extra schema. Order is recruitment order, which drives formation
  // slots, so it must be preserved rather than sorted.
  friends() {
    const raw = this.get('party', '');
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }

  hasFriend(id) { return this.friends().includes(id); }

  addFriend(id) {
    if (!id) return false;
    const list = this.friends();
    if (list.includes(id)) return false;
    list.push(id);
    this.mark('party', list.join(','));
    return true;
  }

  removeFriend(id) {
    const list = this.friends().filter(f => f !== id);
    this.mark('party', list.join(','));
  }
  unmark(key) { this.marks.delete(key); }

  has(id) { return this.decisions.has(id); }
  choiceOf(id) { return this.decisions.has(id) ? this.decisions.get(id) : -1; }
  get(key, fallback = null) {
    return this.marks.has(key) ? this.marks.get(key) : fallback;
  }

  // --- condition evaluation -------------------------------------------------

  // Evaluate one term. Never throws on malformed input — unknown terms are
  // simply false, so a typo in authored JSON hides content rather than
  // crashing the scene load.
  test(term) {
    if (typeof term !== 'string' || !term) return false;
    let t = term.trim();
    let negate = false;
    while (t.startsWith('!')) { negate = !negate; t = t.slice(1).trim(); }

    // Operator must be matched longest-first so ">=" isn't read as ">".
    let op = null, key = t, want = null;
    for (const cand of ['>=', '<=', '=', '>', '<']) {
      const i = t.indexOf(cand);
      if (i > 0) { op = cand; key = t.slice(0, i).trim(); want = t.slice(i + cand.length).trim(); break; }
    }

    const cmp = (a, b) => {
      const x = Number(a), y = Number(b);
      switch (op) {
        case '>=': return x >= y;
        case '<=': return x <= y;
        case '>': return x > y;
        case '<': return x < y;
        default: return String(a) === String(b);
      }
    };

    let result;
    if (key === '#party') {
      // party size thresholds: "#party>=3" gates the late hordes
      result = op ? cmp(this.friends().length, want) : this.friends().length > 0;
    } else if (key.startsWith('+')) {
      result = this.hasFriend(key.slice(1));
    } else if (key.startsWith('@')) {
      const mk = key.slice(1);
      result = op === null ? !!this.get(mk, false) : cmp(this.get(mk, ''), want);
    } else {
      result = op === null ? this.has(key) : (this.has(key) && cmp(this.choiceOf(key), want));
    }
    return negate ? !result : result;
  }

  // Gate an authored object with `requires` (all) and/or `requiresAny` (any).
  allows(def) {
    if (!def) return true;
    const all = def.requires;
    const any = def.requiresAny;
    if (Array.isArray(all) && all.length && !all.every(t => this.test(t))) return false;
    if (Array.isArray(any) && any.length && !any.some(t => this.test(t))) return false;
    return true;
  }

  // --- persistence ----------------------------------------------------------

  serialize() {
    return {
      d: [...this.decisions.entries()].map(([id, c]) => `${id}=${c}`),
      m: [...this.marks.entries()].map(([k, v]) => `${k}=${v}`),
    };
  }

  restore(data) {
    this.decisions.clear();
    this.marks.clear();
    if (!data) return;
    for (const s of data.d ?? []) {
      const i = String(s).lastIndexOf('=');
      if (i > 0) this.decisions.set(s.slice(0, i), Number(s.slice(i + 1)) | 0);
    }
    for (const s of data.m ?? []) {
      const i = String(s).lastIndexOf('=');
      if (i > 0) {
        const raw = s.slice(i + 1);
        const num = Number(raw);
        this.marks.set(
          s.slice(0, i),
          raw === 'true' ? true : raw === 'false' ? false
            : (raw !== '' && !Number.isNaN(num)) ? num : raw
        );
      }
    }
  }

  clear() { this.decisions.clear(); this.marks.clear(); }
}

export const journal = new Journal();
