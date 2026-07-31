// Portable save codes (Amendment 07 §S): pure encode/decode between the
// checkpoint snapshot and a compact, human-copyable string. Bit-packed binary
// → CRC-16 checksum → Crockford-style Base32 (no I/L/O/U; confusables mapped
// on input) with an 'E1' version prefix and dash grouping. ID tables come
// from the live data files (manifest + the biome's own checkpoint/encounter
// arrays), never a hand-maintained mapping (§S.6). Zero dependencies.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VERSION = 'E1';

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
    return {
      version: 1,
      checkpointId,
      biome: biomeId,
      savedAt: Date.now(),
      player: { x, facing, stamina, endurance, health, mana, artifacts, classId, skills, maxHealth, xp, level },
      world: { timeOfDay, flags },
    };
  } catch {
    return null;
  }
}
