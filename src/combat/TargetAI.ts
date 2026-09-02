/**
 * TargetAI — a tactical targeting brain shared by both sides of combat.
 *
 * The engine previously chose targets at random (monsters) or "nearest"
 * (party), which made fights read as noise: monsters whaled on whoever they
 * landed next to, and heroes each attacked a different foe so nothing ever
 * actually died. This module scores candidates so both sides act with intent:
 *
 *  - Monsters finish downed heroes, deny healing by targeting the healer,
 *    and converge on the squishy backline casters that hurt them most.
 *  - The party designates a per-round FOCUS TARGET (nearly-dead foes first,
 *    then the boss, then the biggest threat) so damage actually pools and
 *    enemies drop, instead of everyone spreading attacks around.
 *
 * Scoring is pure and deterministic-in-shape (a little jitter keeps fights
 * from reading as scripted), so it is easy to unit-test and reason about.
 */

import { GameCharacter } from '../entities/Character';
import { Monster } from '../entities/Monster';
import { Party } from '../entities/Party';
import { manhattan, Vector2 } from '../engine/types';

// ── Party-member roles (mirrors AIDirector.classifyRole) ──────────────

type MemberRole = 'healer' | 'controller' | 'support' | 'tank' | 'scout' | 'striker';

function roleOf(member: GameCharacter): MemberRole {
  switch (member.charClass.id) {
    case 'cleric':
    case 'druid':
      return 'healer';
    case 'wizard':
    case 'sorcerer':
      return 'controller';
    case 'bard':
    case 'warlock':
      return 'support';
    case 'fighter':
    case 'barbarian':
    case 'paladin':
      return 'tank';
    case 'rogue':
    case 'ranger':
      return 'scout';
    case 'monk':
      return 'striker';
    default:
      return 'striker';
  }
}

function isCaster(member: GameCharacter): boolean {
  const r = roleOf(member);
  return r === 'healer' || r === 'controller' || r === 'support';
}

// ── Monster candidate scoring (which party member to hit) ────────────

export interface MonsterTargetChoice {
  target: GameCharacter;
  reason: string;
}

/**
 * Choose which party member a monster attacks.
 *
 * A monster is a threat, not an idiot: it prefers to
 *   1. strike the killing blow on a downed but not-dead hero (auto-crit),
 *   2. deny the party its sustain (the healer / a low-HP ally about to act),
 *   3. hit the reachable squishy backline caster it can actually damage,
 *   4. fall back on the closest reachable hero.
 * A little jitter avoids every monster piling onto one hero like a script.
 */
export function chooseMonsterTarget(
  party: Party,
  monster: Monster,
  opts: { maxReach?: number } = {},
): MonsterTargetChoice {
  const maxReach = opts.maxReach ?? 4; // tiles the monster can realistically engage
  const candidates = party.members.filter(m => m.isAlive);
  if (candidates.length === 0) {
    // Nobody alive — fall back to anyone (even a downed hero, for the coup).
    const any = party.members.find(m => !m.isDead);
    if (any) return { target: any, reason: 'no one left standing' };
    throw new Error('chooseMonsterTarget called with an empty party');
  }

  const monsterPos = monster.tile;
  let best: GameCharacter = candidates[0];
  let bestScore = -Infinity;
  let bestReason = 'nearest reachable';

  for (const member of candidates) {
    let score = 0;
    const hpPct = member.hp / Math.max(1, member.maxHp);
    const dist = manhattan(monsterPos, member.tile);
    const reachable = dist <= maxReach;
    const role = roleOf(member);

    // Reach matters most: a monster can't fight what it can't reach.
    if (reachable) score += 24;
    else score += Math.max(0, 12 - dist);

    // Finishing a downed hero is worth an auto-crit.
    if (member.hp <= 0 && !member.isDead) score += 40;

    // Deny the party's sustain: healers and casters are force multipliers.
    if (role === 'healer') score += 18;
    else if (role === 'controller') score += 13;
    else if (role === 'support') score += 10;

    // Squishy backline (low AC) is easier to crack; a caster is doubly juicy.
    if (member.ac <= 13) score += 8;
    if (isCaster(member) && member.ac <= 14) score += 6;

    // A wounded-but-standing hero is one hit from being downed — finish them.
    if (hpPct > 0 && hpPct < 0.3) score += 12;
    else if (hpPct > 0 && hpPct < 0.5) score += 6;

    // Rallying the party: taking the leader is a morale blow.
    if (member === party.leader) score += 5;

    // Deterministic-in-shape jitter so packs don't all stack one hero.
    score += Math.random() * 6;

    if (score > bestScore) {
      bestScore = score;
      best = member;
      // Report the *decisive* tactical reason — the one the monster is acting
      // on — not merely that it can reach the hero. Ordered by how strongly
      // the bonus pulled the decision.
      bestReason =
        member.hp <= 0 && !member.isDead ? 'to finish off the fallen' :
        role === 'healer' ? 'to cut off their healing' :
        isCaster(member) ? 'the soft backline caster' :
        (hpPct > 0 && hpPct < 0.3) ? 'to drop the wounded' :
        member === party.leader ? 'to break the party leader' :
        reachable ? 'the closest reachable threat' :
        member.ac <= 13 ? 'the lightly-armored hero' :
        'the nearest hero';
    }
  }

  return { target: best, reason: bestReason };
}

// ── Party focus-target scoring (which monster to gang up on) ─────────

export interface PartyFocusChoice {
  target: Monster;
  reason: string;
}

/**
 * Pick the ONE monster the whole party should focus this round so damage
 * pools and foes actually die. Priority:
 *   1. a monster already near death (kill it before it acts again),
 *   2. the boss (the fight's win condition),
 *   3. the highest-threat / toughest live foe,
 *   4. the nearest foe as a fallback so the melee isn't star-crossed.
 */
export function choosePartyFocus(
  party: Party,
  monsters: Monster[],
  opts: { killThreshold?: number } = {},
): PartyFocusChoice {
  const alive = monsters.filter(m => m.isAlive);
  if (alive.length === 0) {
    throw new Error('choosePartyFocus called with no living monsters');
  }

  // A party's kill power ~ the average of a couple of strong hits. If any foe
  // is under that, it's the round's read: finish it.
  const killThreshold = opts.killThreshold ?? 14;
  const nearDeath = alive
    .filter(m => m.hp <= killThreshold)
    .sort((a, b) => a.hp - b.hp)[0];
  if (nearDeath) return { target: nearDeath, reason: `nearly dead (${nearDeath.hp} HP) — finish it` };

  const boss = alive.find(m => m.isBoss);
  if (boss) return { target: boss, reason: 'the boss — take it down' };

  // Highest CR is the biggest threat; tie-break by most HP remaining.
  const biggest = [...alive].sort((a, b) => {
    if (b.template.cr !== a.template.cr) return b.template.cr - a.template.cr;
    return b.hp - a.hp;
  })[0];
  return { target: biggest, reason: `the biggest threat (CR ${biggest.template.cr})` };
}

// ── In-combat convenience for a monster ganging up on the party ──────

export function isPartyBackline(member: GameCharacter): boolean {
  return isCaster(member);
}

export type { MemberRole };
