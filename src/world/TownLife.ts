/**
 * TownLife — the living pulse of towns. Caravans roll between towns along
 * the roads (merchant cart plus guards, parked in the market square when they
 * arrive), festivals begin and end on their own clocks, and each town carries
 * a rumor that reshapes its quest board between visits.
 *
 * All scheduling uses real timestamps, so time passes even while the game is
 * closed — a town can be mid-festival when the party returns days later.
 */

import { Overworld, OverworldTown, getTownById } from './Overworld';
import { Wanderer, WandererKind } from './OverworldLife';
import { TileMap, TileType } from './TileMap';
import { Vector2, manhattan } from '../engine/types';
import { QuestGiver, generateQuestGivers } from '../quests/QuestGivers';
import { TownEvent, rollTownEvent } from './TownTypes';
import { BulletinTask, generateBulletinTasks } from '../quests/BulletinBoard';

export type RumorBias = 'hunt' | 'depth' | 'boss' | 'rich' | 'fey' | 'undead' | 'dragon' | 'none';

/** Mechanical buff granted by buying a round at the tavern. */
export interface TownRumorBuff {
  /** Short name for the buff. */
  name: string;
  /** Description of the mechanical effect. */
  description: string;
  /** Flat bonus to damage dealt. */
  damageBonus: number;
  /** Flat bonus to AC. */
  acBonus: number;
  /** Flat bonus to attack rolls. */
  attackBonus: number;
  /** Bonus gold found after combat. */
  goldFindBonus: number;
  /** Bonus XP per fight. */
  xpBonus: number;
}

export interface Rumor {
  text: string;
  bias: RumorBias;
}

const RUMORS: Rumor[] = [
  { text: 'The road east has gone quiet — too many carts, too few returning.', bias: 'hunt' },
  { text: 'A merchant swore she saw lights moving deep in the hills last night.', bias: 'depth' },
  { text: 'The graveyard keeper says the dead have started digging up.', bias: 'undead' },
  { text: 'A dragon was seen circling the peaks. The guild is posting bounties.', bias: 'dragon' },
  { text: 'There is gold in the ruins — the last crew to go in never came out.', bias: 'rich' },
  { text: 'The fey have been leaving gifts on doorsteps. Everyone is too polite to refuse.', bias: 'fey' },
  { text: 'Something big moved under the town during the last storm.', bias: 'boss' },
  { text: 'The constable is hiring anyone who can swing a blade — the cells are full of werewolves.', bias: 'hunt' },
  { text: 'A map surfaced in the tavern showing a sealed vault beneath the old temple.', bias: 'depth' },
  { text: 'The merchants are squabbling over a new route — whoever clears it names the toll.', bias: 'rich' },
  { text: 'Traders whisper that the old barrow has a new tenant — something with cold breath.', bias: 'undead' },
  { text: 'A prophecy-seller claims the deepest floor of the nearest delve holds a wish.', bias: 'boss' },
];

export interface Festival {
  name: string;
  kind: string;
  until: number;
  startedAt: number;
}

interface FestivalTemplate { name: string; kind: string }

const FESTIVALS: FestivalTemplate[] = [
  { name: 'the Festival of Lanterns', kind: 'lights' },
  { name: 'the Harvest Fair', kind: 'harvest' },
  { name: 'the Day of the Moon', kind: 'moon' },
  { name: 'the Anvil-Choir', kind: 'music' },
  { name: 'the Solstice Fete', kind: 'solstice' },
  { name: 'the Feast of the First Keg', kind: 'ale' },
  { name: 'the Midsummer Fling', kind: 'dance' },
];

export const FESTIVAL_FLAVOR: Record<string, string> = {
  lights: 'every roof wears a row of glowing paper lanterns',
  harvest: 'the square is piled with grain, gourds, and prize pumpkins',
  moon: 'silver candles line the streets and the temple stays open all night',
  music: 'dwarven choirs shake the rafters and the inns never close',
  solstice: 'bonfires ring the town and children chase sparks',
  ale: 'the first keg of the season rolls out and no one is sober',
  dance: 'ribbons and fiddles — the whole square turns into a dance floor',
};

export interface TownLife {
  townId: string;
  rumor: string;
  rumorBias: RumorBias;
  /** When the current rumor was set — visits soon after keep it. */
  rumorSince: number;
  nextFestivalAt: number;
  festival: Festival | null;
  nextCaravanAt: number;
  /** Named NPCs who live in this town and hand out quests. */
  questGivers: QuestGiver[];
  /** Active town event, if any. */
  event: TownEvent | null;
  /** When the current event expires. */
  eventUntil: number;
  /** Total gold spent by the party in this town. Drives prosperity discounts. */
  prosperitySpent: number;
  /** Whether the party has registered with the local guild. */
  guildRegistered: boolean;
  /** Per-town reputation (separate from NPC reputation). 0-100. */
  townReputation: number;
  /** Active tavern rumor buff for this town (applies for next N fights). */
  tavernBuff: TownRumorBuff | null;
  /** Number of fights the tavern buff has left. */
  tavernBuffFightsLeft: number;
  /** Bulletin board tasks for this town. */
  bulletinTasks: BulletinTask[];
  /** How many times the party has visited this town (drives task generation). */
  visitCount: number;
}

export interface Caravan {
  id: string;
  fromTownId: string;
  toTownId: string;
  /** Road path (Road/Bridge/Town tiles) from source to destination. */
  route: Vector2[];
  routeIndex: number;
  /** 0 = outbound, 1 = returning home. */
  leg: 0 | 1;
  restUntil: number;
  state: 'traveling' | 'resting';
  wandererIds: string[];
}

export interface TownLifeState {
  byTown: Record<string, TownLife>;
  caravans: Caravan[];
}

export interface TownLifeContext {
  partyTile: Vector2;
  partyTownId: string | null;
  maxCaravans?: number;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function pickRumor(): Rumor {
  return RUMORS[Math.floor(Math.random() * RUMORS.length)];
}

/** Tavern rumor buffs: bought with 10 gp at the tavern, last for N fights. */
const TAVERN_BUFFS: (TownRumorBuff & { narration: string })[] = [
  {
    name: 'Boss Weakness Intel',
    description: 'The bartender heard the dungeon boss is vulnerable to your weapons.',
    damageBonus: 3, acBonus: 0, attackBonus: 1, goldFindBonus: 0, xpBonus: 0,
    narration: 'The bartender leans in: the boss on the deepest floor hates fire — and steel.',
  },
  {
    name: 'Lucky Coins',
    description: 'A lucky charm found in the ale. Bonus gold after fights.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 25, xpBonus: 0,
    narration: 'You find a strange coin at the bottom of your drink — it feels warm in your palm.',
  },
  {
    name: 'Barroom Brawl Training',
    description: 'You sparred with the locals. Sharper reflexes in combat.',
    damageBonus: 0, acBonus: 1, attackBonus: 2, goldFindBonus: 0, xpBonus: 0,
    narration: 'A half-orc teaches you a dirty trick — watch their eyes, not their hands.',
  },
  {
    name: 'Campfire Tales',
    description: 'Old adventurers shared hard-won wisdom. Bonus XP from fights.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 0, xpBonus: 15,
    narration: 'A scarred veteran tells you how she survived the deep — knowledge is worth its weight in gold.',
  },
  {
    name: 'Hearty Meal',
    description: 'A massive meal and strong ale. Boosted vigor for the road.',
    damageBonus: 1, acBonus: 0, attackBonus: 1, goldFindBonus: 10, xpBonus: 5,
    narration: 'The stew is thick, the bread is fresh, and the ale hits like a hammer. You feel unstoppable.',
  },
  {
    name: 'Thieves\' Tips',
    description: 'A shady figure whispers about hidden treasure locations.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 40, xpBonus: 0,
    narration: 'A figure in the corner slides you a note: check behind the waterfall on floor 2.',
  },
];

/** Roll a random tavern buff (or null if nothing special). */
export function rollTavernBuff(): TownRumorBuff | null {
  if (Math.random() > 0.70) return null; // 30% chance
  const buff = TAVERN_BUFFS[Math.floor(Math.random() * TAVERN_BUFFS.length)];
  return { name: buff.name, description: buff.description, damageBonus: buff.damageBonus, acBonus: buff.acBonus, attackBonus: buff.attackBonus, goldFindBonus: buff.goldFindBonus, xpBonus: buff.xpBonus };
}

/** Get the narration for a tavern buff. */
export function getTavernBuffNarration(buff: TownRumorBuff): string {
  const found = TAVERN_BUFFS.find(b => b.name === buff.name);
  return found?.narration ?? 'The barkeep nods knowingly.';
}

export function initTownLife(overworld: Overworld, now: number = Date.now()): TownLifeState {
  const byTown: Record<string, TownLife> = {};
  for (const town of overworld.towns) {
    const rumor = pickRumor();
    byTown[town.id] = {
      townId: town.id,
      rumor: rumor.text,
      rumorBias: rumor.bias,
      rumorSince: now,
      nextFestivalAt: now + randInt(90, 240) * 1000,
      festival: null,
      nextCaravanAt: now + randInt(15, 70) * 1000,
      questGivers: generateQuestGivers(town.id),
      event: null,
      eventUntil: 0,
      prosperitySpent: 0,
      guildRegistered: false,
      townReputation: 0,
      tavernBuff: null,
      tavernBuffFightsLeft: 0,
      bulletinTasks: [],
      visitCount: 0,
    };
  }
  return { byTown, caravans: [] };
}

/** Check if a town has an active event (not expired). */
export function eventFor(tl: TownLifeState, townId: string, now: number = Date.now()): TownEvent | null {
  const e = tl.byTown[townId]?.event;
  if (e && now <= (tl.byTown[townId]?.eventUntil ?? 0)) return e;
  return null;
}

/**
 * Calculate the dynamic price modifier for a town based on prosperity,
 * caravan presence, and festivals.
 */
export function townPriceModifier(
  tl: TownLifeState,
  townId: string,
  baseModifier: number,
  now: number = Date.now(),
): number {
  const entry = tl.byTown[townId];
  if (!entry) return baseModifier;
  let mod = baseModifier;
  // Prosperity discount: 1% off per 100 gp spent, max 15% off.
  const prosperityDiscount = Math.min(0.15, entry.prosperitySpent / 10000);
  mod *= (1 - prosperityDiscount);
  // Reputation discount: up to 25% off at max reputation.
  const repDiscount = Math.min(0.25, entry.townReputation / 400);
  mod *= (1 - repDiscount);
  // Festival discount: 10% off during festivals.
  if (entry.festival && now <= entry.festival.until) mod *= 0.9;
  // Caravan discount: 5% off when a caravan is in town.
  if (tl.caravans.some(c => c.toTownId === townId && c.state === 'resting' && now <= c.restUntil)) mod *= 0.95;
  return Math.round(mod * 100) / 100;
}

/** Refresh the bulletin board for a town when the party arrives. */
export function refreshBulletinBoard(
  tl: TownLifeState,
  townId: string,
  overworld: Overworld,
  partyLevel: number,
): BulletinTask[] {
  const entry = tl.byTown[townId];
  if (!entry) return [];
  entry.visitCount++;
  // Work the party has already taken on survives the new posting; only the
  // untouched notices are replaced. Regenerating everything used to wipe a
  // half-finished task the moment the party walked back into town.
  const inFlight = entry.bulletinTasks.filter(t => t.accepted && !t.completed);
  const claimable = entry.bulletinTasks.filter(t => t.completed);
  const fresh = generateBulletinTasks(
    overworld.towns.find(t => t.id === townId)!,
    entry.visitCount,
    partyLevel,
    overworld.entrances,
  );
  const taken = new Set([...inFlight, ...claimable].map(t => t.id));
  entry.bulletinTasks = [...inFlight, ...claimable, ...fresh.filter(t => !taken.has(t.id))];
  return entry.bulletinTasks;
}

/** Roll a new event for a town when the party arrives. Returns the event or null. */
export function rollArrivalEvent(tl: TownLifeState, townId: string, now: number = Date.now()): TownEvent | null {
  const entry = tl.byTown[townId];
  if (!entry) return null;
  // Don't stack events — if one is active, keep it.
  if (entry.event && now <= entry.eventUntil) return entry.event;
  const evt = rollTownEvent();
  if (evt) {
    entry.event = evt;
    entry.eventUntil = now + evt.duration;
  } else {
    entry.event = null;
    entry.eventUntil = 0;
  }
  return entry.event;
}

/** A town's current celebration, if any. */
export function festivalFor(tl: TownLifeState, townId: string, now: number = Date.now()): Festival | null {
  const f = tl.byTown[townId]?.festival;
  if (f && now > f.until) return null;
  return f ?? null;
}

/** Advance the world: caravans roll, festivals begin and end, departures leave. */
export function tickTownLife(
  state: TownLifeState,
  overworld: Overworld,
  map: TileMap,
  wanderers: Wanderer[],
  now: number,
  ctx: TownLifeContext,
): string[] {
  const lines: string[] = [];
  const maxCaravans = ctx.maxCaravans ?? 4;

  for (const town of overworld.towns) {
    const tl = state.byTown[town.id];
    if (!tl) continue;
    const partyHere = ctx.partyTownId === town.id;

    // Festivals begin and end on their own clocks.
    if (!tl.festival && now > tl.nextFestivalAt) {
      const tpl = FESTIVALS[Math.floor(Math.random() * FESTIVALS.length)];
      tl.festival = { name: tpl.name, kind: tpl.kind, until: now + randInt(45, 120) * 1000, startedAt: now };
      if (partyHere) {
        lines.push(`🎪 ${town.name} has begun ${tpl.name} — ${FESTIVAL_FLAVOR[tpl.kind] || 'the town is celebrating'}!`);
      }
    } else if (tl.festival && now > tl.festival.until) {
      tl.festival = null;
      tl.nextFestivalAt = now + randInt(150, 360) * 1000;
      if (partyHere) lines.push(`The festival in ${town.name} winds down; the square returns to trade and gossip.`);
    }

    // A caravan departs on schedule (one per town at a time, cap total).
    const tiedToThisTown = state.caravans.some(c => c.fromTownId === town.id || c.toTownId === town.id);
    if (!tiedToThisTown && state.caravans.length < maxCaravans && now > tl.nextCaravanAt) {
      const dest = pickOtherTown(overworld, town);
      if (dest) {
        const caravan = spawnCaravan(town, dest, map, wanderers);
        state.caravans.push(caravan);
        tl.nextCaravanAt = now + randInt(120, 300) * 1000;
        if (partyHere) {
          lines.push(`🛒 A caravan of ${randInt(2, 4)} wagons and guards departs ${town.name} for ${dest.name}.`);
        }
      }
    }
  }

  // Advance in-flight caravans along the roads.
  const finished: Caravan[] = [];
  for (const c of state.caravans) {
    const dest = getTownById(overworld, c.toTownId);
    const home = getTownById(overworld, c.fromTownId);
    if (!dest) continue;

    if (c.state === 'traveling') {
      c.routeIndex++;
      // The last route tile is the destination town's center.
      if (c.routeIndex >= c.route.length - 1) {
        c.routeIndex = c.route.length - 1;
        if (c.leg === 1) {
          // Back home — the caravan dissolves into the town's bustle.
          removeCaravan(c, wanderers);
          finished.push(c);
          if (home && manhattan(home.tile, ctx.partyTile) <= 16) {
            lines.push(`🛒 The caravan that left ${home.name} rolls back into the yard — goods unloaded, drivers paid.`);
          }
          continue;
        }
        // Arrived at the destination — park in the market square.
        c.state = 'resting';
        c.restUntil = now + randInt(15, 40) * 1000;
        parkCaravan(c, dest, wanderers);
        if (manhattan(dest.tile, ctx.partyTile) <= 16) {
          lines.push(`🛒 A caravan rolls into ${dest.name}${home ? ` from ${home.name}` : ''} — crates, spices, and fresh rumors for the market.`);
        }
        continue;
      }
      syncCaravan(c, wanderers);
    } else if (c.state === 'resting') {
      if (now > c.restUntil) {
        // Load up and head back home.
        c.leg = 1;
        c.state = 'traveling';
        c.route.reverse();
        c.routeIndex = 0;
        syncCaravan(c, wanderers);
        if (manhattan(dest.tile, ctx.partyTile) <= 16) {
          lines.push(`🛒 The caravan in ${dest.name} loads up and turns back toward ${home?.name ?? 'home'}.`);
        }
      }
    }
  }
  if (finished.length > 0) {
    state.caravans = state.caravans.filter(c => !finished.includes(c));
  }
  return lines;
}

function pickOtherTown(overworld: Overworld, town: OverworldTown): OverworldTown | undefined {
  const others = overworld.towns.filter(t => t.id !== town.id);
  if (others.length === 0) return undefined;
  return others[Math.floor(Math.random() * others.length)];
}

/** BFS along roads (Road / Bridge / Town tiles) from one town center to another. */
function roadPath(map: TileMap, from: Vector2, to: Vector2): Vector2[] {
  const w = map.width;
  const h = map.height;
  const startIdx = from.y * w + from.x;
  const endIdx = to.y * w + to.x;
  if (startIdx < 0 || endIdx < 0 || startIdx >= w * h || endIdx >= w * h) return [from, to];
  const prev = new Int32Array(w * h).fill(-1);
  const q: number[] = [startIdx];
  prev[startIdx] = startIdx;
  let head = 0;
  let found = false;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === endIdx) { found = true; break; }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      const t = map.getTile(nx, ny);
      if (t !== TileType.Road && t !== TileType.Bridge && t !== TileType.Town) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (!found) return [from, to];
  const path: Vector2[] = [];
  let cur = endIdx;
  while (cur !== startIdx) {
    path.push({ x: cur % w, y: (cur / w) | 0 });
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

function spawnCaravan(from: OverworldTown, to: OverworldTown, map: TileMap, wanderers: Wanderer[]): Caravan {
  const route = roadPath(map, from.tile, to.tile);
  const id = `caravan_${Math.random().toString(36).slice(2, 8)}`;
  const make = (kind: WandererKind, name: string): Wanderer => ({
    id: `wanderer_${id}_${kind}`,
    kind,
    name,
    tile: { ...route[0] },
    target: { ...route[0] },
    speed: 0, // TownLife moves caravans; stepWanderers leaves them alone.
    message: '',
    shy: 0,
    phase: Math.random() * Math.PI * 2,
    recent: [],
  });
  const merchant = make('merchant', `${from.name} Caravan`);
  const g1 = make('guard', 'Caravan Guard');
  const g2 = make('guard', 'Caravan Guard');
  wanderers.push(merchant, g1, g2);
  return {
    id,
    fromTownId: from.id,
    toTownId: to.id,
    route,
    routeIndex: 0,
    leg: 0,
    restUntil: 0,
    state: 'traveling',
    wandererIds: [merchant.id, g1.id, g2.id],
  };
}

function syncCaravan(c: Caravan, wanderers: Wanderer[]): void {
  const [m, g1, g2] = c.wandererIds.map(id => wanderers.find(w => w.id === id));
  const idx = c.routeIndex;
  if (m) m.tile = { ...c.route[idx] };
  if (g1) g1.tile = { ...c.route[Math.max(0, idx - 1)] };
  if (g2) g2.tile = { ...c.route[Math.max(0, idx - 2)] };
}

function parkCaravan(c: Caravan, dest: OverworldTown, wanderers: Wanderer[]): void {
  const [m, g1, g2] = c.wandererIds.map(id => wanderers.find(w => w.id === id));
  if (m) m.tile = { ...dest.tile };
  if (g1) g1.tile = { x: dest.tile.x + 1, y: dest.tile.y };
  if (g2) g2.tile = { x: dest.tile.x - 1, y: dest.tile.y };
}

function removeCaravan(c: Caravan, wanderers: Wanderer[]): void {
  const ids = new Set(c.wandererIds);
  for (let i = wanderers.length - 1; i >= 0; i--) {
    if (ids.has(wanderers[i].id)) wanderers.splice(i, 1);
  }
}

/** Drop in-flight caravans (their wanderers too) but keep town clocks/rumors. */
export function sanitizeTownLife(state: TownLifeState | undefined, overworld: Overworld): TownLifeState {
  if (!state || !state.byTown) return initTownLife(overworld);
  const byTown: Record<string, TownLife> = {};
  for (const town of overworld.towns) {
    const prev = state.byTown[town.id];
    if (prev) {
      // Preserve quest-giver reputation across saves; regenerate if missing.
      byTown[town.id] = { ...prev, questGivers: prev.questGivers ?? generateQuestGivers(town.id), event: prev.event ?? null, eventUntil: prev.eventUntil ?? 0, prosperitySpent: prev.prosperitySpent ?? 0, guildRegistered: prev.guildRegistered ?? false, townReputation: prev.townReputation ?? 0, tavernBuff: prev.tavernBuff ?? null, tavernBuffFightsLeft: prev.tavernBuffFightsLeft ?? 0, bulletinTasks: prev.bulletinTasks ?? [], visitCount: prev.visitCount ?? 0 };
    } else {
      byTown[town.id] = initTownLife(overworld).byTown[town.id];
    }
  }
  return { byTown, caravans: [] };
}

/** True if the wanderer belongs to a caravan (used to scrub on restore). */
export function isCaravanWanderer(w: Wanderer): boolean {
  return w.id.startsWith('wanderer_caravan_');
}
