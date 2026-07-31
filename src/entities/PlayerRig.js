// Age-stage rig parameters (§5, Amendment 02 §F): continuous interpolation
// between stage keyframes — height grows Child → Adult and then HOLDS (no
// elder shrinking, §F.1), head ratio evens out, posture stoops late, hair and
// beard grey together (§F.2). Also the age-based stat curve from §5: children
// regenerate fast but hit soft; elders lose physical ceiling but cast better.

import { clamp, lerp, lerpColor } from '../core/utils.js';

// keyframes by in-game days lived
const STAGES = [
  { day: 0,  name: 'Child',       hs: 0.68, head: 1.38, stoop: 0,    grey: 0,   beard: 0,    beardA: 0,   regen: 1.3,  dmg: 0.7,  manaR: 1.0 },
  { day: 2,  name: 'Youth',       hs: 0.86, head: 1.14, stoop: 0,    grey: 0,   beard: 0,    beardA: 0,   regen: 1.15, dmg: 0.9,  manaR: 1.0 },
  { day: 5,  name: 'Adult',       hs: 1.0,  head: 1.0,  stoop: 0,    grey: 0.05, beard: 0.5, beardA: 0.8, regen: 1.0,  dmg: 1.0,  manaR: 1.0 },
  { day: 12, name: 'Middle-aged', hs: 1.0,  head: 1.0,  stoop: 0.05, grey: 0.5, beard: 0.75, beardA: 0.9, regen: 0.9,  dmg: 0.95, manaR: 1.15 },
  { day: 20, name: 'Elder',       hs: 1.0,  head: 1.0,  stoop: 0.13, grey: 1,   beard: 1,    beardA: 1,   regen: 0.8,  dmg: 0.8,  manaR: 1.5 },
];

const HAIR_YOUNG = '#6b4a2f';
const HAIR_GREY = '#c4c0b6';

export function rigParams(ageDays) {
  const d = Math.max(0, ageDays);
  let a = STAGES[0], b = STAGES[0];
  for (let i = 0; i < STAGES.length; i++) {
    if (d >= STAGES[i].day) { a = STAGES[i]; b = STAGES[Math.min(i + 1, STAGES.length - 1)]; }
  }
  const span = b.day - a.day || 1;
  const t = a === b ? 1 : clamp((d - a.day) / span, 0, 1);
  const s = t * t * (3 - 2 * t);
  const grey = lerp(a.grey, b.grey, s);
  return {
    stage: a.name,
    heightScale: lerp(a.hs, b.hs, s),
    headRel: lerp(a.head, b.head, s),
    stoop: lerp(a.stoop, b.stoop, s),
    hairColor: lerpColor(HAIR_YOUNG, HAIR_GREY, grey),
    beardLen: lerp(a.beard, b.beard, s),
    beardAlpha: lerp(a.beardA, b.beardA, s),
    beardColor: lerpColor('#5a3d26', '#d8d4ca', grey),
    regenMult: lerp(a.regen, b.regen, s),
    damageMult: lerp(a.dmg, b.dmg, s),
    manaRegenMult: lerp(a.manaR, b.manaR, s),
  };
}

export function stageName(ageDays) { return rigParams(ageDays).stage; }
