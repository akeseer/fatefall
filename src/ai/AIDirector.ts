/**
 * AIDirector — Tactical Dungeon-Crawling Brain
 *
 * Full D&D party AI with:
 *  - Role-based combat (tank, healer, striker, controller, support)
 *  - Formation awareness and positioning
 *  - Resource management (spell slots, HP, hit dice)
 *  - Healing priorities and triage
 *  - Spell selection by enemy type and party state
 *  - Trap awareness and dungeon interaction
 *  - Short/long rest decisions
 *  - Morale and retreat logic
 *  - Treasure seeking
 *  - Environmental awareness
 */

import { GameCharacter } from '../entities/Character';
import { Monster } from '../entities/Monster';
import { Party } from '../entities/Party';
import { TileMap, TileType } from '../world/TileMap';
import type { Room } from '../world/DungeonGenerator';
import { Vector2, Direction, manhattan } from '../engine/types';
import { SPELLS, isCaster, getCasterType } from '../data/gameData';
import type { Spell } from '../data/gameData';

// ── Role Classification ──────────────────────────────

type CombatRole = 'tank' | 'healer' | 'striker' | 'controller' | 'support' | 'scout';

function classifyRole(char: GameCharacter): CombatRole {
  const cls = char.charClass.id;
  switch (cls) {
    case 'fighter':
    case 'barbarian':
    case 'paladin':
      return 'tank';
    case 'cleric':
    case 'druid':
      return 'healer';
    case 'rogue':
    case 'ranger':
      return 'scout';
    case 'wizard':
    case 'sorcerer':
      return 'controller';
    case 'bard':
    case 'warlock':
      return 'support';
    case 'monk':
      return 'striker';
    default:
      return 'striker';
  }
}

// ── Threat Assessment ────────────────────────────────

interface ThreatInfo {
  monster: Monster;
  threat: number; // 0-100
  distance: number;
  isBoss: boolean;
  type: string;
  estimatedHp: number;
}

function assessThreat(
  monster: Monster,
  partyPos: Vector2,
  partyAvgHpPct: number,
  partyLevel: number,
): ThreatInfo {
  const dist = manhattan(partyPos, monster.tile);
  const cr = monster.template.cr;
  const isBoss = monster.template.name.startsWith('💀');

  // Base threat from CR relative to party level
  let threat = Math.min(100, (cr / Math.max(1, partyLevel)) * 30);

  // Distance modifier: closer = more threatening
  threat += Math.max(0, (10 - dist) * 5);

  // Boss multiplier
  if (isBoss) threat *= 1.5;

  // Party health modifier: when party is hurt, everything feels more dangerous
  threat *= (1 + (1 - partyAvgHpPct) * 0.5);

  // Type-based threat adjustments
  const type = monster.template.type.toLowerCase();
  if (type.includes('dragon') || type.includes('aberration')) threat *= 1.3;
  if (type.includes('undead') && type.includes('swarm')) threat *= 0.8;

  return {
    monster,
    threat: Math.min(100, threat),
    distance: dist,
    isBoss,
    type: monster.template.type,
    estimatedHp: monster.hp,
  };
}

// ── Party State Analysis ─────────────────────────────

interface PartyState {
  avgHpPct: number;
  lowestHpPct: number;
  dyingCount: number;
  deadCount: number;
  consciousCount: number;
  totalMembers: number;
  hasHealer: boolean;
  hasTank: boolean;
  hasController: boolean;
  totalSpellSlots: number;
  maxSpellSlots: number;
  averageLevel: number;
  totalGold: number;
  hasRevivify: boolean;
  membersBelowHalf: number;
  membersCritical: number; // below 25%
}

function analyzeParty(party: Party): PartyState {
  const alive = party.alive;
  const all = party.members;
  const hpPcts = alive.map(m => m.hp / m.maxHp);
  const avgHpPct = hpPcts.length > 0 ? hpPcts.reduce((a, b) => a + b, 0) / hpPcts.length : 0;
  const lowestHpPct = hpPcts.length > 0 ? Math.min(...hpPcts) : 0;

  let totalSlots = 0;
  let maxSlots = 0;
  let totalLevel = 0;
  let totalGold = 0;
  let hasHealer = false;
  let hasTank = false;
  let hasController = false;

  for (const m of all) {
    totalLevel += m.level;
    totalGold += m.gold;
    for (let i = 1; i <= 9; i++) {
      totalSlots += m.spellSlots[i] || 0;
      maxSlots += m.maxSpellSlots[i] || 0;
    }
    const role = classifyRole(m);
    if (role === 'healer') hasHealer = true;
    if (role === 'tank') hasTank = true;
    if (role === 'controller') hasController = true;
  }

  return {
    avgHpPct,
    lowestHpPct,
    dyingCount: all.filter(m => m.isDying).length,
    deadCount: all.filter(m => m.isDead).length,
    consciousCount: alive.length,
    totalMembers: all.length,
    hasHealer,
    hasTank,
    hasController,
    totalSpellSlots: totalSlots,
    maxSpellSlots: maxSlots,
    averageLevel: all.length > 0 ? totalLevel / all.length : 1,
    totalGold,
    // There is no Revivify spell in the game; the only way to raise the dead
    // on the spot is a scroll someone is carrying.
    hasRevivify: all.some(m => m.inventory.some(i => i.id === 'scroll_revivify')),
    membersBelowHalf: hpPcts.filter(p => p < 0.5).length,
    membersCritical: hpPcts.filter(p => p < 0.25).length,
  };
}

// ── Healing Triage ───────────────────────────────────

interface HealPriority {
  target: GameCharacter;
  urgency: number; // 0-100
  reason: string;
}

function triageHealing(party: Party, state: PartyState): HealPriority[] {
  const priorities: HealPriority[] = [];

  for (const member of party.members) {
    if (member.isDead || member.isDying) continue;
    const hpPct = member.hp / member.maxHp;
    const role = classifyRole(member);

    let urgency = 0;
    let reason = '';

    // Critical: below 25% HP
    if (hpPct < 0.25) {
      urgency = 90;
      reason = 'critically wounded';
    }
    // Wounded: below 50% HP
    else if (hpPct < 0.5) {
      urgency = 60;
      reason = 'badly wounded';
    }
    // Lightly wounded: below 75% HP
    else if (hpPct < 0.75) {
      urgency = 30;
      reason = 'lightly wounded';
    }

    // Role priority: healers and tanks first
    if (role === 'healer') urgency += 15;
    if (role === 'tank') urgency += 10;

    // Leader priority
    if (member === party.leader) urgency += 5;

    if (urgency > 0) {
      priorities.push({ target: member, urgency, reason });
    }
  }

  return priorities.sort((a, b) => b.urgency - a.urgency);
}

// ── Spell Selection Intelligence ─────────────────────

interface SpellChoice {
  spellId: string;
  slotLevel: number;
  target?: Monster;
  reason: string;
}

function chooseOffensiveSpell(
  caster: GameCharacter,
  enemies: Monster[],
  state: PartyState,
): SpellChoice | null {
  const knownSpells = caster.knownSpells
    .map(id => SPELLS.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // Find damage spells the caster can afford
  const damageSpells = knownSpells.filter(s =>
    s.level > 0 && s.damage && caster.canCastSpell(s.level),
  );

  if (damageSpells.length === 0) return null;

  // Sort by damage potential (rough heuristic: level * dice count)
  damageSpells.sort((a, b) => {
    const aDmg = parseDamageDice(a.damage || '0');
    const bDmg = parseDamageDice(b.damage || '0');
    return bDmg - aDmg;
  });

  // Pick the best spell we can afford
  for (const spell of damageSpells) {
    const slotLevel = findBestSlot(caster, spell.level);
    if (slotLevel !== null) {
      // If enemies are clustered, prefer AoE; otherwise single-target
      const isAoE = spell.range?.includes('cone') || spell.range?.includes('cube') ||
                    spell.range?.includes('line') || spell.range?.includes('sphere');
      const hasManyFoes = enemies.length >= 3;

      if (isAoE && hasManyFoes) {
        return { spellId: spell.id, slotLevel, reason: `Area effect against ${enemies.length} foes` };
      }
      if (!isAoE && enemies.length <= 2) {
        return { spellId: spell.id, slotLevel, target: enemies[0], reason: 'Focused damage' };
      }
    }
  }

  // Fallback: use cantrips
  const cantrips = knownSpells.filter(s => s.level === 0 && s.damage);
  if (cantrips.length > 0) {
    const chosen = cantrips[0];
    return { spellId: chosen.id, slotLevel: 0, reason: 'Conserving spell slots (cantrip)' };
  }

  return null;
}

function chooseSupportSpell(
  caster: GameCharacter,
  state: PartyState,
): SpellChoice | null {
  const knownSpells = caster.knownSpells
    .map(id => SPELLS.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // Healing spells when allies are hurt
  const healSpells = knownSpells.filter(s =>
    s.healing && caster.canCastSpell(s.level),
  );

  if (healSpells.length > 0 && state.membersBelowHalf > 0) {
    // Right-sized healing: cheapest spell that helps, smallest slot that fits
    // the emergency. No burning 3rd-level slots to top off a scratch.
    healSpells.sort((a, b) => a.level - b.level);
    const best = healSpells[0];
    const slotLevel = findBestSlot(caster, best.level);
    if (slotLevel !== null) {
      return { spellId: best.id, slotLevel, reason: `Healing ${state.membersBelowHalf} wounded allies` };
    }
  }

  // Buff spells (Bless, Shield, etc.)
  const buffSpells = knownSpells.filter(s =>
    !s.damage && !s.healing && s.level > 0 && s.level <= 2 && caster.canCastSpell(s.level),
  );

  if (buffSpells.length > 0 && state.avgHpPct > 0.6) {
    // Contextual buff choice instead of a coin flip: Bless (an attack/save
    // force multiplier) when the party is hurting, protective buffs when
    // we're healthy, otherwise the cheapest thing we can afford.
    const pickBuff = (): { spell: Spell; why: string } | null => {
      const bless = buffSpells.find(s => /bless/i.test(s.name));
      const protective = buffSpells.find(s => /shield|armor|ward|resist|protection|sanctuary/i.test(s.name));
      if (state.avgHpPct < 0.85 && bless) return { spell: bless, why: 'Blessing the party for the fight ahead' };
      if (protective) return { spell: protective, why: `Warding the party with ${protective.name}` };
      const cheapest = [...buffSpells].sort((a, b) => a.level - b.level)[0];
      return cheapest ? { spell: cheapest, why: `Buffing the party with ${cheapest.name}` } : null;
    };
    const picked = pickBuff();
    if (picked) {
      const slotLevel = findBestSlot(caster, picked.spell.level);
      if (slotLevel !== null) {
        return { spellId: picked.spell.id, slotLevel, reason: picked.why };
      }
    }
  }

  return null;
}

function parseDamageDice(dmg: string): number {
  const match = dmg.match(/(\d+)d(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]) * parseInt(match[2]);
}

function findBestSlot(caster: GameCharacter, minLevel: number): number | null {
  // Find the lowest slot that's >= minLevel and available
  for (let i = minLevel; i <= 9; i++) {
    if ((caster.spellSlots[i] || 0) > 0) return i;
  }
  return null;
}

// ── Combat Tactics ───────────────────────────────────

interface CombatTactics {
  /** Who should we focus-fire? */
  primaryTarget: Monster | null;
  /** Should we retreat? */
  shouldRetreat: boolean;
  /** Should we rest? */
  shouldRest: boolean;
  /** Formation adjustment */
  formation: 'tight' | 'spread' | 'protective' | 'aggressive';
  /** Engagement range */
  engagement: 'melee' | 'ranged' | 'mixed';
  /** Morale message */
  bark: string;
}

function computeTactics(
  party: Party,
  threats: ThreatInfo[],
  state: PartyState,
  knownFoes: Set<string>,
): CombatTactics {
  // Sort threats by priority
  const sorted = [...threats].sort((a, b) => {
    // Boss first
    if (a.isBoss && !b.isBoss) return -1;
    if (!a.isBoss && b.isBoss) return 1;
    // Then by threat level
    return b.threat - a.threat;
  });

  const primaryTarget = sorted[0]?.monster || null;
  // "We know how these fight" — a kind the party has slain many times is a
  // known quantity, so the party holds the line longer and fights smarter.
  const primaryKnown = primaryTarget ? knownFoes.has(primaryTarget.template.id) : false;

  // Retreat logic
  let shouldRetreat = false;
  if (state.consciousCount <= 1) shouldRetreat = true;
  if (state.avgHpPct < 0.2 && threats.length > 1 && !primaryKnown) shouldRetreat = true;
  if (state.dyingCount >= 2) shouldRetreat = true;

  // Rest logic
  let shouldRest = false;
  if (state.avgHpPct < 0.3 && threats.length === 0) shouldRest = true;
  if (state.totalSpellSlots < state.maxSpellSlots * 0.2 && threats.length === 0) shouldRest = true;

  // Formation
  let formation: CombatTactics['formation'] = 'tight';
  if (state.membersCritical > 0) formation = 'protective';
  else if (state.avgHpPct > 0.7) formation = 'aggressive';
  else if (threats.length > 3) formation = 'spread';

  // Engagement range
  let engagement: CombatTactics['engagement'] = 'mixed';
  if (state.consciousCount <= 2) engagement = 'ranged';

  // Barks — battle-worn confidence replaces panic when the foe is well known.
  let bark = generateCombatBark(state, threats);
  if (primaryKnown && !shouldRetreat && state.avgHpPct >= 0.3 && state.dyingCount === 0) {
    bark = pick([
      'We know how these fight — hold the line!',
      'We\'ve beaten their kind before. Press them!',
      'No fear — we know their every trick!',
      'Same foe, same answer: cut them down!',
      'They can\'t surprise us. Advance!',
    ]);
  }

  return { primaryTarget, shouldRetreat, shouldRest, formation, engagement, bark };
}

function generateCombatBark(state: PartyState, threats: ThreatInfo[]): string {
  if (state.avgHpPct < 0.2) {
    return pick([
      'We\'re barely standing — fall back!',
      'We need to retreat, now!',
      'Hold the line... somehow!',
      'I can\'t take much more...',
    ]);
  }
  if (state.dyingCount > 0) {
    return pick([
      'Someone\'s down! Get them up!',
      'We\'ve lost one — press on!',
      'Bind their wounds! Now!',
    ]);
  }
  if (threats.length > 3) {
    return pick([
      'We\'re surrounded! Tight formation!',
      'Too many of them — focus fire!',
      'Watch your backs — they\'re everywhere!',
    ]);
  }
  if (threats.some(t => t.isBoss)) {
    return pick([
      'That\'s the boss — everything on it!',
      'Target the big one! Now!',
      'This is the one that matters — strike hard!',
    ]);
  }
  return pick([
    'Form up!',
    'To arms!',
    'Stand together!',
    'I see them — attack!',
    'No mercy!',
    'For glory!',
    'We fight as one!',
    'Steady now... charge!',
    'They shall fall!',
    'Into the fray!',
    'Hold the line!',
    'Flank them!',
    'Watch the rear!',
    'Conserve your spells!',
    'Press the advantage!',
    'Steel yourselves!',
  ]);
}

// ── Dungeon Exploration Intelligence ─────────────────

interface ExploreChoice {
  direction: Direction;
  reason: string;
  urgency: 'normal' | 'cautious' | 'eager';
  /** True when the party is following a BFS path to a real destination. */
  pathing?: boolean;
  /** Optional custom narration for pathing moves. */
  message?: string;
}

type ExploreTargetKind = 'stairs' | 'room' | 'tile';

interface ExploreTarget {
  pos: Vector2;
  kind: ExploreTargetKind;
}

/**
 * BFS over walkable tiles from `from`. The party is a flexible formation
 * (it funnels single-file through any passage the leader can walk), so only
 * the leader's tile matters for pathing. Returns the distance to every tile
 * and the predecessor map for path reconstruction (-1 = unreachable).
 */
function formationBfs(
  map: TileMap,
  from: Vector2,
): { dist: Int32Array; prev: Int32Array } {
  const w = map.width;
  const h = map.height;
  const dist = new Int32Array(w * h).fill(-1);
  const prev = new Int32Array(w * h).fill(-1);
  const startIdx = from.y * w + from.x;
  dist[startIdx] = 0;
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  q[tail++] = startIdx;
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1) continue;
      if (!map.isWalkable(nx, ny)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q[tail++] = ni;
    }
  }
  return { dist, prev };
}

/** Reconstruct the tile path from `from` (exclusive) to `to` (inclusive). */
function pathFromPrev(
  prev: Int32Array,
  width: number,
  from: Vector2,
  to: Vector2,
): Vector2[] | null {
  const startIdx = from.y * width + from.x;
  const goalIdx = to.y * width + to.x;
  if (goalIdx === startIdx) return [];
  if (prev[goalIdx] === -1) return null;
  const path: Vector2[] = [];
  let cur = goalIdx;
  while (cur !== startIdx) {
    path.push({ x: cur % width, y: (cur / width) | 0 });
    cur = prev[cur];
    if (cur === -1) return null;
  }
  path.reverse();
  return path;
}

/**
 * Pick the nearest worthwhile destination using BFS distances:
 * revealed stairs first, then the nearest unexplored room, then the nearest
 * unexplored walkable tile beyond the immediate fringe.
 */
function pickTargetFromDist(
  map: TileMap,
  rooms: Room[],
  dist: Int32Array,
): ExploreTarget | null {
  let best: ExploreTarget | null = null;
  let bestD = Infinity;
  const consider = (pos: Vector2, kind: ExploreTargetKind) => {
    const d = dist[pos.y * map.width + pos.x];
    if (d < 0) return;
    if (d < bestD) {
      bestD = d;
      best = { pos, kind };
    }
  };

  // 1. Revealed stairs — the way down to a brand-new zone.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getTile(x, y) === TileType.StairsDown && map.explored[y]?.[x]) {
        consider({ x, y }, 'stairs');
      }
    }
  }

  // 2. Unexplored room centers.
  for (const r of rooms) {
    if (!map.explored[r.cy]?.[r.cx]) consider({ x: r.cx, y: r.cy }, 'room');
  }

  // 3. Unexplored walkable tiles past the immediate fringe (d >= 4 avoids
  //    oscillating between the two nearest fringe tiles).
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.explored[y]?.[x]) continue;
      if (!map.isWalkable(x, y)) continue;
      const d = dist[y * map.width + x];
      if (d >= 4 && d < bestD) {
        bestD = d;
        best = { pos: { x, y }, kind: 'tile' };
      }
    }
  }

  return best;
}

function chooseExplorationDirection(
  map: TileMap,
  pos: Vector2,
  party: Party,
  state: PartyState,
  lastDir: Direction,
  sameDirCount: number,
  recentTiles: { x: number; y: number }[] = [],
): ExploreChoice {
  const leader = party.leader;
  const personality = leader.personality;

  const walkableDirs: Direction[] = [];
  const unexploredDirs: Direction[] = [];

  for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
    const nx = pos.x + (dir === Direction.Left ? -1 : dir === Direction.Right ? 1 : 0);
    const ny = pos.y + (dir === Direction.Up ? -1 : dir === Direction.Down ? 1 : 0);

    // The party is a flexible formation — followers funnel single-file, so
    // only the leader's tile has to be walkable.
    if (map.isWalkable(nx, ny)) {
      walkableDirs.push(dir);
      if (!map.explored[ny]?.[nx]) {
        unexploredDirs.push(dir);
      }
    }
  }

  if (walkableDirs.length === 0) {
    return { direction: Direction.Down, reason: 'No way forward — dead end', urgency: 'cautious' };
  }

  // Recency: 0 = most recently visited tile, -1 = not seen recently. The
  // wander below never picks a direction that would immediately retrace
  // recent ground — that's what makes parties trace squares.
  const recency = (dir: Direction): number => {
    const nx = pos.x + (dir === Direction.Left ? -1 : dir === Direction.Right ? 1 : 0);
    const ny = pos.y + (dir === Direction.Up ? -1 : dir === Direction.Down ? 1 : 0);
    for (let i = recentTiles.length - 1; i >= 0; i--) {
      if (recentTiles[i].x === nx && recentTiles[i].y === ny) return recentTiles.length - 1 - i;
    }
    return -1;
  };
  const freshDirs = walkableDirs.filter(d => recency(d) === -1);
  const pickDir = (pool: Direction[], reason: string, urgency: ExploreChoice['urgency']): ExploreChoice => ({
    direction: pool[Math.floor(Math.random() * pool.length)],
    reason,
    urgency,
  });

  // If hurt, be cautious — prefer known safe paths (retreat is intentional).
  if (state.avgHpPct < 0.3) {
    const exploredDirs = walkableDirs.filter(d => !unexploredDirs.includes(d));
    if (exploredDirs.length > 0) {
      return pickDir(exploredDirs, 'Retreating along known path', 'cautious');
    }
  }

  // High curiosity = explore unexplored
  if (personality.curiosity > 6 && unexploredDirs.length > 0) {
    return pickDir(unexploredDirs, 'Exploring the unknown', 'eager');
  }

  // High greed = seek treasure (unexplored has better loot chances)
  if (personality.greed > 6 && unexploredDirs.length > 0) {
    return pickDir(unexploredDirs, 'Seeking treasure', 'eager');
  }

  // High caution = stick to explored, but avoid retracing recent ground.
  if (personality.caution > 6) {
    const explored = walkableDirs.filter(d => !unexploredDirs.includes(d));
    const safe = explored.filter(d => recency(d) === -1);
    if (safe.length > 0) return pickDir(safe, 'Cautiously retracing steps', 'cautious');
    if (explored.length > 0) return pickDir(explored, 'Cautiously retracing steps', 'cautious');
  }

  // Prefer unexplored, then ground never visited recently, then the
  // least-recently-visited exit — the party spirals outward instead of
  // pacing a square.
  if (unexploredDirs.length > 0) {
    return pickDir(unexploredDirs, 'Venturing into the unknown', 'normal');
  }
  if (freshDirs.length > 0) {
    return pickDir(freshDirs, 'Continuing exploration', 'normal');
  }
  const leastRecent = [...walkableDirs].sort((a, b) => recency(b) - recency(a))[0];
  return pickDir([leastRecent], 'Circling outward — avoiding old ground', 'normal');
}

// ── AI Action Types (expanded) ───────────────────────

export type AIAction =
  | { type: 'explore'; direction: Direction; message: string; pathing?: boolean }
  | { type: 'attack'; target: Monster; message: string }
  /** Head for a chest or other lootable the party can see. */
  | { type: 'loot'; target: Vector2; direction: Direction; message: string }
  | { type: 'retreat'; direction: Direction; message: string }
  | { type: 'rest'; message: string }
  /** Spend a revivify scroll on a fallen ally instead of stopping to rest. */
  | { type: 'revive'; message: string }
  | { type: 'enter_door' | 'go_down_stairs'; message: string }
  | { type: 'heal'; message: string }
  | { type: 'flee'; message: string }
  | { type: 'regroup'; message: string }
  | { type: 'scout'; direction: Direction; message: string }
  | { type: 'idle'; message: string };

// ── AIDirector ───────────────────────────────────────

export class AIDirector {
  private party: Party;
  /** Monster template ids the party has slain enough of to know cold. */
  public knownFoes: Set<string> = new Set();
  private lastDirection: Direction = Direction.Down;
  private directionBias: number = 0;
  private searchTarget: Vector2 | null = null;
  private restCounter: number = 0;
  private sameDirCount: number = 0;
  /** Rolling recent leader tiles — the wander never immediately retraces them. */
  private recentTiles: { x: number; y: number }[] = [];
  /** The destination the party is currently marching toward. */
  private exploreTarget: ExploreTarget | null = null;
  private exploreTargetAge: number = 0;
  private combatLog: string[] = [];
  private turnCount: number = 0;
  private lastCombatTurn: number = 0;

  constructor(party: Party) {
    this.party = party;
  }

  decideAction(
    map: TileMap,
    visibleMonsters: Monster[],
    lootNearby: Vector2[],
    doorsNearby: Vector2[],
    stairsNearby: Vector2[],
    rooms: Room[],
  ): AIAction {
    this.turnCount++;
    const state = analyzeParty(this.party);
    const leader = this.party.leader;

    // ── PHASE 1: Immediate Threats ──
    if (visibleMonsters.length > 0) {
      return this.handleCombat(visibleMonsters, state, map, leader);
    }

    // ── PHASE 2: Fallen Allies ──
    if (state.deadCount > 0) {
      // No monster is in view (Phase 1 handled combat), so the party stops to
      // tend the fallen instead of pressing deeper with a crippled team.
      //
      // A revivify scroll is spent here rather than merely mentioned. What it
      // buys is the rest: a party that stops to tend its dead spends dungeon
      // time, and dungeon time is wandering monsters. Each scroll lifts one
      // ally where they lie. When the last is gone the next tick falls through
      // to the rest below, which revives at 1 HP, so however many have fallen
      // this can never loop.
      if (state.hasRevivify) {
        return {
          type: 'revive',
          message: `${leader.name}: "${pick([
            'We carry a scroll of revivify — unroll it and bring them back.',
            'Break out the revivify scroll. Nobody stays down while we still have it.',
            'The scroll. Use the scroll — we are not burying anyone today.',
          ])}"`,
        };
      }
      return {
        type: 'rest',
        message: `${leader.name}: "${pick([
            'We don\'t leave anyone behind. Rest — tend to the fallen.',
            'Gather round — get them back on their feet before we go further.',
            'The dead need tending. We rest here until they can walk again.',
        ])}"`,
      };
    }
    if (state.dyingCount > 0) {
      return this.handleDyingAllies(state, leader);
    }

    // ── PHASE 3: Rest Decisions ──
    // Rest when hurt and no threat is in VIEW (Phase 1 handled visible
    // monsters). Requiring every monster in the dungeon to be dead meant a
    // party that fled a fight could never recover — it wandered the floor
    // at 1 HP forever instead of resting and getting back on its goal.
    if (state.avgHpPct < 0.3 && visibleMonsters.length === 0) {
      this.restCounter++;
      if (this.restCounter >= 3 || state.avgHpPct < 0.15) {
        this.restCounter = 0;
        return {
          type: 'rest',
          message: `The party takes a desperate short rest... ${state.dyingCount > 0 ? 'and tends to the fallen.' : ''}`,
        };
      }
    } else {
      this.restCounter = 0;
    }

    // ── PHASE 4: Spell Slot Recovery ──
    if (state.totalSpellSlots < state.maxSpellSlots * 0.3 && visibleMonsters.length === 0) {
      this.restCounter++;
      if (this.restCounter >= 5) {
        this.restCounter = 0;
        return {
          type: 'rest',
          message: 'The party pauses to recover spell slots...',
        };
      }
    }

    // ── PHASE 5: Dungeon Interaction ──
    if (doorsNearby.length > 0) {
      const doorTile = doorsNearby[0];
      const dir = this.getDirectionTo(leader.tile, doorTile);
      return {
        type: 'enter_door',
        message: `${leader.name}: "${pick([
          'A door... let\'s see what\'s beyond.',
          'Careful now — doors in dungeons hide surprises.',
          'I\'ll check for traps first.',
          'Together on three...',
        ])}"`,
      };
    }

    if (stairsNearby.length > 0 && state.avgHpPct > 0.5) {
      return {
        type: 'go_down_stairs',
        message: `${leader.name}: "${pick([
          'Deeper into the dungeon we go...',
          'Stairs down. Fortune favors the bold.',
          'Ready yourselves — what lies below is always worse.',
          'The darkness beckons...',
        ])}"`,
      };
    }

    // ── PHASE 6: Loot Seeking ──
    if (lootNearby.length > 0) {
      // Nearest first, so the party does not walk past one chest to reach another.
      const target = [...lootNearby].sort(
        (a, b) => manhattan(leader.tile, a) - manhattan(leader.tile, b),
      )[0];
      return {
        type: 'loot',
        target,
        direction: this.getDirectionTo(leader.tile, target),
        message: `${leader.name} spots something glinting in the dark...`,
      };
    }

    // ── PHASE 7: Scout for Traps ──
    if (state.consciousCount >= 3 && Math.random() < 0.15) {
      const scoutDir = this.lastDirection;
      return {
        type: 'scout',
        direction: scoutDir,
        message: `${leader.name}: "${pick([
          'Let me check ahead for traps...',
          'Scouting the path forward.',
          'Something feels off — let\'s be careful.',
        ])}"`,
      };
    }

    // ── PHASE 8: Exploration ──
    const explore = this.chooseExploration(map, rooms, leader.tile, state);
    // Remember where the party has been so the wander never retraces it.
    this.recentTiles.push({ x: leader.tile.x, y: leader.tile.y });
    if (this.recentTiles.length > 14) this.recentTiles.shift();

    this.lastDirection = explore.direction;
    const dirName = { up: 'north', down: 'south', left: 'west', right: 'east' }[explore.direction];

    let message: string;
    if (explore.message) {
      message = explore.message;
    } else if (explore.urgency === 'eager') {
      message = `${leader.name}: "${pick([
        'There\'s something this way — I can feel it!',
        'Unexplored territory — what riches await?',
        'The unknown calls to us...',
      ])}" — ${this.party.alive.map(m => m.name).join(', ')} push ${dirName}.`;
    } else if (explore.urgency === 'cautious') {
      message = `${leader.name}: "${pick([
        'Carefully now...',
        'Watch your step.',
        'Stay close and keep your weapons ready.',
      ])}" — The party moves ${dirName} cautiously.`;
    } else {
      message = `${leader.name} leads the party ${dirName}...`;
    }

    return { type: 'explore', direction: explore.direction, message };
  }

  /**
   * Destination-driven exploration. The party keeps a target (revealed
   * stairs, nearest unexplored room, or nearest unexplored tile) and
   * marches the BFS path toward it, so it actually progresses zone to
   * zone instead of pacing the same room. Falls back to the local wander
   * when no target exists.
   */
  private chooseExploration(
    map: TileMap,
    rooms: Room[],
    pos: Vector2,
    state: PartyState,
  ): ExploreChoice {
    // Hurt parties retrace known paths instead of pressing deeper.
    if (state.avgHpPct < 0.3) {
      return chooseExplorationDirection(
        map, pos, this.party, state, this.lastDirection, this.sameDirCount, this.recentTiles,
      );
    }

    this.exploreTargetAge++;
    const target = this.exploreTarget;
    const currentValid =
      !!target &&
      !(target.pos.x === pos.x && target.pos.y === pos.y) &&
      (target.kind === 'stairs'
        ? map.getTile(target.pos.x, target.pos.y) === TileType.StairsDown
        : !map.explored[target.pos.y]?.[target.pos.x]);

    // Commit to a destination: only re-pick when it's reached, becomes
    // invalid, or has been held for a long march (~32s at default pace).
    // Re-picking every few ticks made the party zig-zag between two
    // equally close rooms instead of focusing on one goal.
    if (!currentValid || this.exploreTargetAge >= 40) {
      // Re-pick the destination using BFS distances (nearest reachable wins).
      const { dist } = formationBfs(map, pos);
      let fresh = pickTargetFromDist(map, rooms, dist);
      // Anti-oscillation: keep the current target while it is within four
      // tiles of the freshest pick, so the party doesn't zig-zag between
      // two equally close unexplored rooms.
      if (currentValid && target && fresh) {
        const curIdx = target.pos.y * map.width + target.pos.x;
        const curD = dist[curIdx];
        if (curD >= 0 && curD <= dist[fresh.pos.y * map.width + fresh.pos.x] + 4) {
          fresh = target;
        }
      }
      this.exploreTarget = fresh;
      this.exploreTargetAge = 0;
    }

    const live = this.exploreTarget;
    if (live) {
      const { prev } = formationBfs(map, pos);
      const path = pathFromPrev(prev, map.width, pos, live.pos);
      if (path && path.length > 0) {
        const first = path[0];
        const direction =
          first.x === pos.x
            ? first.y > pos.y ? Direction.Down : Direction.Up
            : first.x > pos.x ? Direction.Right : Direction.Left;
        const dirName = { up: 'north', down: 'south', left: 'west', right: 'east' }[direction];
        const message =
          live.kind === 'stairs'
            ? `${this.party.leader.name}: "The stairs down are this way — deeper into the dark!" — the party pushes ${dirName}.`
            : live.kind === 'room'
              ? `${this.party.leader.name}: "An untouched chamber lies ${dirName} — that way!" — the party pushes ${dirName}.`
              : `${this.party.leader.name} pushes into the unknown ${dirName}...`;
        return {
          direction,
          reason: 'Navigating toward a new area',
          urgency: 'eager',
          pathing: true,
          message,
        };
      }
      // Unreachable — drop it and wander this tick.
      this.exploreTarget = null;
      this.exploreTargetAge = 0;
    }

    return chooseExplorationDirection(
      map, pos, this.party, state, this.lastDirection, this.sameDirCount, this.recentTiles,
    );
  }

  // ── Combat Handler ──────────────────────────────────

  private handleCombat(
    visibleMonsters: Monster[],
    state: PartyState,
    map: TileMap,
    leader: GameCharacter,
  ): AIAction {
    const threats = visibleMonsters.map(m =>
      assessThreat(m, leader.tile, state.avgHpPct, state.averageLevel),
    );

    const tactics = computeTactics(this.party, threats, state, this.knownFoes);

    // Retreat if overwhelmed
    if (tactics.shouldRetreat) {
      const safestDir = this.findEscapeDirection(map, leader.tile, visibleMonsters);
      return {
        type: 'flee',
        message: `${leader.name}: "${tactics.bark}" — The party retreats!`,
      };
    }

    // Target the highest-threat enemy
    const target = tactics.primaryTarget || visibleMonsters[0];

    const names = this.party.alive.map(m => m.name).join(', ');
    return {
      type: 'attack',
      target,
      message: `${leader.name}: "${tactics.bark}" — ${names} engage ${target.template.name}!`,
    };
  }

  // ── Dying Allies Handler ────────────────────────────

  private handleDyingAllies(state: PartyState, leader: GameCharacter): AIAction {
    if (state.hasHealer) {
      return {
        type: 'heal',
        message: `${leader.name}: "${pick([
          'Someone\'s down! Get them up!',
          'We can\'t lose anyone — heal them!',
          'Hold on, we\'re coming!',
          'Pour every healing spell into them!',
        ])}"`,
      };
    }
    return {
      type: 'regroup',
      message: `${leader.name}: "${pick([
        'We\'ve lost one — we need to fall back!',
        'Without a healer, we can\'t save them...',
        'We must press on — for their sake.',
      ])}"`,
    };
  }

  // ── Escape Direction ────────────────────────────────

  private findEscapeDirection(
    map: TileMap,
    pos: Vector2,
    threats: Monster[],
  ): Direction {
    let bestDir = Direction.Down;
    let bestScore = -Infinity;

    for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
      const nx = pos.x + (dir === Direction.Left ? -1 : dir === Direction.Right ? 1 : 0);
      const ny = pos.y + (dir === Direction.Up ? -1 : dir === Direction.Down ? 1 : 0);

      if (!map.isWalkable(nx, ny)) continue;

      // Score: prefer directions away from threats
      let score = 0;
      for (const t of threats) {
        const distBefore = manhattan(pos, t.tile);
        const distAfter = manhattan({ x: nx, y: ny }, t.tile);
        score += (distAfter - distBefore) * 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }

    return bestDir;
  }

  // ── Direction Helper ────────────────────────────────

  private getDirectionTo(from: Vector2, to: Vector2): Direction {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? Direction.Right : Direction.Left;
    }
    return dy > 0 ? Direction.Down : Direction.Up;
  }

  // ── Public Helpers ──────────────────────────────────

  getExplorationStyle(): string {
    const p = this.party.leader.personality;
    if (p.caution > 7) return 'cautious';
    if (p.aggression > 7) return 'aggressive';
    if (p.curiosity > 7) return 'curious';
    if (p.greed > 7) return 'treasure-hunting';
    return 'balanced';
  }

  /** Get a summary of the party's current tactical posture */
  getTacticalSummary(): string {
    const state = analyzeParty(this.party);
    const roles = this.party.alive.map(m => `${m.name}(${classifyRole(m)})`).join(', ');
    return `Party: ${state.consciousCount}/${state.totalMembers} alive, ${Math.round(state.avgHpPct * 100)}% HP avg, ` +
      `${state.totalSpellSlots}/${state.maxSpellSlots} slots. Roles: ${roles}. ` +
      `Style: ${this.getExplorationStyle()}.`;
  }
}

// ── Utility ──────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
