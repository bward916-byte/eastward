// Portable save codes (Amendment 07 §S): pure encode/decode between the
// checkpoint snapshot and a compact, human-copyable string. Bit-packed binary
// → CRC-16 checksum → Crockford-style Base32 (no I/L/O/U; confusables mapped
// on input) with an 'E1' version prefix and dash grouping. ID tables come
// from the live data files (manifest + the biome's own checkpoint/encounter
// arrays), never a hand-maintained mapping (§S.6). Zero dependencies.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VERSION = 'E4';  // E1-E3 codes predate the Journal — cleanly rejected

function crc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

function toBase32(bytes) {
  let bits = 0, acc = 0, out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function fromBase32(str) {
  let bits = 0, acc = 0;
  const out = [];
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return out;
}

function normalize(code) {
  return code.toUpperCase().replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

const u8 = (a, v) => a.push(Math.max(0, Math.min(255, Math.round(v))));
const u16 = (a, v) => { const x = Math.max(0, Math.min(65535, Math.round(v))); a.push(x >> 8, x & 255); };

export function encodeSnapshot(snap, biome, manifest) {
  const b = [];
  u8(b, Math.max(0, manifest.biomes.indexOf(snap.biome)));
  const cps = biome.checkpoints ?? [];
  const cpIdx = cps.findIndex(c => c.id === snap.checkpointId);
  u8(b, cpIdx < 0 ? 255 : cpIdx);
  u16(b, snap.player.x);
  u8(b, snap.player.facing > 0 ? 1 : 0);
  u8(b, snap.player.stamina);
  u8(b, snap.player.endurance);
  u8(b, snap.player.health ?? 100);
  u8(b, snap.player.mana ?? 0);
  u8(b, snap.player.artifacts ?? 0);
  u8(b, snap.player.identified ?? 0);
  u16(b, snap.player.gold ?? 0);
  u8(b, snap.player.classId ? manifest.classes.indexOf(snap.player.classId) : 255);
  u16(b, (snap.world?.timeOfDay ?? 0.32) * 65535);
  const sk = snap.player.skills ?? {};
  u8(b, (sk.accuracy ?? 1) * 20);
  u8(b, (sk.fightSpeed ?? 1) * 20);
  u8(b, (sk.autoDodge ?? 0) * 20);
  u8(b, (sk.climbSkill ?? 1) * 20);
  u8(b, snap.player.maxHealth ?? 100);
  u16(b, snap.player.xp ?? 0);
  u8(b, snap.player.level ?? 0);
  u16(b, (snap.player.ageDays ?? 0) * 10);
  const INJ = ['limp', 'arm', 'bruise', 'chill'];
  let injBits = 0;
  for (const k of snap.player.injuries ?? []) {
    const idx = INJ.indexOf(k);
    if (idx >= 0) injBits |= 1 << idx;
  }
  u8(b, injBits);
  // worldFlags as a bitfield over the biome's encounter order (§S.4.1)
  const encs = biome.encounters ?? [];
  const flags = new Set(snap.world?.flags ?? []);
  u8(b, encs.length);
  for (let i = 0; i < encs.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8 && i + j < encs.length; j++) {
      if (flags.has(encs[i + j].id)) byte |= 1 << j;
    }
    b.push(byte);
  }
  // Journal (§Journal): one nibble per manifest.journalKeys entry —
  // 0 = never recorded, else choice index + 1. Two keys per byte. The key
  // table is append-only, so old positions keep their meaning.
  const jkeys = manifest.journalKeys ?? [];
  const jd = new Map((snap.world?.journal?.d ?? []).map(str => {
    const i = String(str).lastIndexOf('=');
    return i > 0 ? [str.slice(0, i), Number(str.slice(i + 1)) | 0] : [String(str), 0];
  }));
  u8(b, jkeys.length);
  for (let i = 0; i < jkeys.length; i += 2) {
    const lo = jd.has(jkeys[i]) ? Math.min(15, jd.get(jkeys[i]) + 1) : 0;
    const hi = (i + 1 < jkeys.length && jd.has(jkeys[i + 1]))
      ? Math.min(15, jd.get(jkeys[i + 1]) + 1) : 0;
    b.push((hi << 4) | lo);
  }
  // companion mark as an index into the append-only companions table
  const jm = new Map((snap.world?.journal?.m ?? []).map(str => {
    const i = String(str).lastIndexOf('=');
    return i > 0 ? [str.slice(0, i), str.slice(i + 1)] : [String(str), ''];
  }));
  const comps = manifest.companions ?? [];
  const ci = comps.indexOf(jm.get('companion'));
  u8(b, ci >= 0 ? ci : 255);

  const crc = crc16(b);
  u16(b, crc);
  const raw = toBase32(b);
  return VERSION + '-' + (raw.match(/.{1,5}/g) ?? []).join('-');
}

/** Which biome a code belongs to, so the loader can fetch its data first. */
export function peekBiomeIndex(code) {
  const n = normalize(code);
  if (!n.startsWith(VERSION)) return null;
  const bytes = fromBase32(n.slice(VERSION.length));
  return bytes && bytes.length > 3 ? bytes[0] : null;
}

/** Full decode. Returns a SaveManager-shaped snapshot, or null if invalid. */
export function decodeSnapshot(code, biome, manifest) {
  const n = normalize(code);
  if (!n.startsWith(VERSION)) return null;
  const bytes = fromBase32(n.slice(VERSION.length));
  if (!bytes || bytes.length < 6) return null;
  const payload = bytes.slice(0, -2);
  const crc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(payload) !== crc) return null;   // §S.5: reject before touching state

  let i = 0;
  const r8 = () => payload[i++];
  const r16 = () => { const v = (payload[i] << 8) | payload[i + 1]; i += 2; return v; };
  try {
    const biomeIdx = r8();
    const biomeId = manifest.biomes[biomeIdx];
    if (!biomeId || biomeId !== biome.id) return null;
    const cpIdx = r8();
    const cps = biome.checkpoints ?? [];
    const checkpointId = cpIdx === 255 ? null : cps[cpIdx]?.id ?? null;
    const x = r16();
    const facing = r8() ? 1 : -1;
    const stamina = r8(), endurance = r8(), health = r8(), mana = r8();
    const artifacts = r8();
    const identified = r8();
    const gold = r16();
    const clsIdx = r8();
    const classId = clsIdx === 255 ? null : manifest.classes[clsIdx] ?? null;
    const timeOfDay = r16() / 65535;
    const skills = {
      accuracy: r8() / 20, fightSpeed: r8() / 20,
      autoDodge: r8() / 20, climbSkill: r8() / 20,
    };
    const maxHealth = r8();
    const xp = r16();
    const level = r8();
    const ageDays = r16() / 10;
    const injBits = r8();
    const INJ = ['limp', 'arm', 'bruise', 'chill'];
    const injuries = INJ.filter((_, idx) => injBits & (1 << idx));
    const encCount = r8();
    const encs = biome.encounters ?? [];
    if (encCount !== encs.length) return null; // data drift → incompatible code
    const flags = [];
    for (let k = 0; k < encCount; k += 8) {
      const byte = r8();
      for (let j = 0; j < 8 && k + j < encCount; j++) {
        if (byte & (1 << j)) flags.push(encs[k + j].id);
      }
    }
    // Journal — mirror of the encode side (nibble per key, then companion)
    const jkeyCount = r8();
    const jkeys = manifest.journalKeys ?? [];
    if (jkeyCount > jkeys.length) return null;  // code from a newer key table
    const jd = [];
    for (let k = 0; k < jkeyCount; k += 2) {
      const byte = r8();
      const lo = byte & 0x0f, hi = (byte >> 4) & 0x0f;
      if (lo) jd.push(`${jkeys[k]}=${lo - 1}`);
      if (hi && k + 1 < jkeyCount) jd.push(`${jkeys[k + 1]}=${hi - 1}`);
    }
    const compIdx = r8();
    const jm = [];
    const comps = manifest.companions ?? [];
    if (compIdx !== 255 && comps[compIdx]) jm.push(`companion=${comps[compIdx]}`);
    if (classId) jm.push(`class=${classId}`);

    return {
      version: 1,
      checkpointId,
      biome: biomeId,
      savedAt: Date.now(),
      player: { x, facing, stamina, endurance, health, mana, artifacts, identified, gold, classId, skills, maxHealth, xp, level, ageDays, injuries },
      world: { timeOfDay, flags, journal: { d: jd, m: jm } },
    };
  } catch {
    return null;
  }
}
