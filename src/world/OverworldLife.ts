/**
 * Overworld life — the people and beasts that make the surface world feel
 * alive: travelers on the roads, guards at towns, merchants hauling carts,
 * and wildlife (deer, rabbits, herons, wolves) in the wilds. Wanderers walk
 * the roads or roam their biome; wildlife flees when the party approaches.
 *
 * Also hosts the ambient event lines narrated as the party crosses biomes.
 */

import { TileMap, TileType } from './TileMap';
import { Overworld } from './Overworld';
import { Vector2 } from '../engine/types';

export type WandererKind =
  | 'traveler' | 'merchant' | 'guard' | 'pilgrim' | 'scout'
  | 'deer' | 'rabbit' | 'wolf' | 'heron';

export interface Wanderer {
  id: string;
  kind: WandererKind;
  name: string;
  tile: Vector2;
  /** Where it's currently walking to. */
  target: Vector2;
  /** Tiles moved per tick (0 = stays put). */
  speed: number;
  /** Line spoken if the party comes near. */
  message: string;
  /** Wildlife bolts when the party gets within this many tiles. */
  shy: number;
  phase: number; // per-wanderer animation phase
  /** Recently visited tiles — new targets avoid them so nobody paces in circles. */
  recent: { x: number; y: number }[];
}

const TRAVELER_LINES = [
  '"The road to the next town is safe — mostly. Mind the wolves past the ford."',
  '"I saw lights in the ruins last night. Probably nothing."',
  '"The innkeeper in town overcharges for stew. The temple gives better soup."',
  '"Trade\'s good this season. The caravans run every tenday now."',
  '"They say the old crypts are swallowing adventurers whole. You lot going down there?"',
];

const MERCHANT_LINES = [
  '"Fine wares! Potions, scrolls, luck charms — and for you, a discount!"',
  '"Buying or selling? My cart\'s honest, unlike some in town."',
  '"Careful in the wilds — bandits took my last caravan\'s escorts."',
];

const GUARD_LINES = [
  '"Keep to the road after dark. The woods have teeth."',
  '"Papers? ...Relax, I\'m not the tax collector."',
  '"We\'ve been seeing strange tracks near the old barrow."',
];

const PILGRIM_LINES = [
  '"May the road rise to meet you."',
  '"I walk to the shrine at the edge of the world. Care to join?"',
  '"The gods watch every step you take. Try to make it interesting."',
];

const SCOUT_LINES = [
  '"Dungeon entrance that way — heard something big breathing in it."',
  '"I marked the safe path through the swamp. Follow the leaning trees."',
];

export function wandererName(kind: WandererKind): string {
  const first = ['Aldric', 'Mira', 'Thorn', 'Lyra', 'Kael', 'Brin', 'Sable', 'Fen', 'Oren', 'Yara'];
  const last = ['Traveler', 'the Cart-Driver', 'of the Watch', 'the Pilgrim', 'the Scout'];
  switch (kind) {
    case 'traveler': return `${first[Math.floor(Math.random() * first.length)]} the Wanderer`;
    case 'merchant': return `${first[Math.floor(Math.random() * first.length)]} the Merchant`;
    case 'guard': return `Guard ${first[Math.floor(Math.random() * first.length)]}`;
    case 'pilgrim': return `${first[Math.floor(Math.random() * first.length)]} the Pilgrim`;
    case 'scout': return `${first[Math.floor(Math.random() * first.length)]} the Scout`;
    case 'deer': return 'A grazing deer';
    case 'rabbit': return 'A nervous rabbit';
    case 'wolf': return 'A lone wolf';
    case 'heron': return 'A heron by the water';
    default: return last[Math.floor(Math.random() * last.length)];
  }
}

function lineFor(kind: WandererKind): string {
  switch (kind) {
    case 'traveler': return TRAVELER_LINES[Math.floor(Math.random() * TRAVELER_LINES.length)];
    case 'merchant': return MERCHANT_LINES[Math.floor(Math.random() * MERCHANT_LINES.length)];
    case 'guard': return GUARD_LINES[Math.floor(Math.random() * GUARD_LINES.length)];
    case 'pilgrim': return PILGRIM_LINES[Math.floor(Math.random() * PILGRIM_LINES.length)];
    case 'scout': return SCOUT_LINES[Math.floor(Math.random() * SCOUT_LINES.length)];
    default: return '';
  }
}

function isRoadTile(t: TileType): boolean {
  return t === TileType.Road || t === TileType.Bridge || t === TileType.Town;
}

/** Manhattan distance from a spot to the nearest recently-visited tile. */
function distanceFromRecent(spot: Vector2, recent: { x: number; y: number }[]): number {
  let best = Infinity;
  for (const r of recent) {
    const d = Math.abs(spot.x - r.x) + Math.abs(spot.y - r.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Pick a road tile within `radius` of `near`, preferring spots well away from
 * recently-visited tiles so travelers drift instead of pacing back and forth.
 * If every candidate is near old ground, the farthest one wins.
 */
function pickRoadSpot(map: TileMap, near: Vector2, radius: number, recent: { x: number; y: number }[] = []): Vector2 | null {
  let fallback: Vector2 | null = null;
  let fallbackScore = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = near.x + Math.floor((Math.random() * 2 - 1) * radius);
    const y = near.y + Math.floor((Math.random() * 2 - 1) * radius);
    if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) continue;
    if (!isRoadTile(map.getTile(x, y))) continue;
    const spot = { x, y };
    const d = distanceFromRecent(spot, recent);
    if (d > 2) return spot; // clear of recent ground
    if (d > fallbackScore) {
      fallbackScore = d;
      fallback = spot;
    }
  }
  return fallback;
}

/** Same as pickRoadSpot, but for wildlife terrain (with heron/deer/wolf biases). */
function pickWildSpot(map: TileMap, near: Vector2, radius: number, kind: WandererKind, recent: { x: number; y: number }[] = []): Vector2 | null {
  const wantWater = kind === 'heron';
  const wantForest = kind === 'deer' || kind === 'wolf';
  let fallback: Vector2 | null = null;
  let fallbackScore = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = near.x + Math.floor((Math.random() * 2 - 1) * radius);
    const y = near.y + Math.floor((Math.random() * 2 - 1) * radius);
    if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) continue;
    const t = map.getTile(x, y);
    if (wantWater && t !== TileType.Water) continue;
    if (!wantWater && !(t === TileType.Grass || t === TileType.Forest || t === TileType.Sand)) continue;
    if (wantForest && t !== TileType.Forest) continue;
    const spot = { x, y };
    const d = distanceFromRecent(spot, recent);
    if (d > 2) return spot; // clear of recent ground
    if (d > fallbackScore) {
      fallbackScore = d;
      fallback = spot;
    }
  }
  return fallback;
}

export function spawnOverworldLife(overworld: Overworld): Wanderer[] {
  const { map, towns, entrances } = overworld;
  const wanderers: Wanderer[] = [];
  let id = 1;

  const add = (kind: WandererKind, tile: Vector2, speed: number, shy = 0) => {
    wanderers.push({
      id: `wanderer_${id++}`,
      kind,
      name: wandererName(kind),
      tile: { ...tile },
      target: { ...tile },
      speed,
      message: lineFor(kind),
      shy,
      phase: Math.random() * Math.PI * 2,
      recent: [],
    });
  };

  // Towns: guards + a merchant or two
  for (const town of towns) {
    add('guard', { ...town.tile }, 0);
    if (Math.random() < 0.6) add('guard', { x: town.tile.x + 2, y: town.tile.y }, 0);
    if (Math.random() < 0.5) {
      const spot = pickRoadSpot(map, town.tile, 8) ?? { ...town.tile };
      add('merchant', spot, 1);
    }
  }

  // Roads between towns: travelers and pilgrims — scaled to the world.
  const travellerScale = Math.max(1, Math.round(map.width / 240));
  for (let i = 0; i < 14 * travellerScale; i++) {
    const town = towns[Math.floor(Math.random() * towns.length)];
    const spot = pickRoadSpot(map, town.tile, 16);
    if (spot) add(Math.random() < 0.75 ? 'traveler' : 'pilgrim', spot, 1);
  }
  // A scout or two near entrances
  for (let i = 0; i < 6 && entrances.length > 0; i++) {
    const e = entrances[Math.floor(Math.random() * entrances.length)];
    const spot = pickRoadSpot(map, e.tile, 12);
    if (spot) add('scout', spot, 1);
  }

  // Wildlife scattered across the map — denser in the larger world.
  for (let i = 0; i < 12 * travellerScale; i++) {
    const spot = pickWildSpot(map, { x: Math.floor(Math.random() * map.width), y: Math.floor(Math.random() * map.height) }, 30, 'deer');
    if (spot) add('deer', spot, 1, 4);
  }
  for (let i = 0; i < 14 * travellerScale; i++) {
    const spot = pickWildSpot(map, { x: Math.floor(Math.random() * map.width), y: Math.floor(Math.random() * map.height) }, 25, 'rabbit');
    if (spot) add('rabbit', spot, 1, 3);
  }
  for (let i = 0; i < 6 * travellerScale; i++) {
    const spot = pickWildSpot(map, { x: Math.floor(Math.random() * map.width), y: Math.floor(Math.random() * map.height) }, 40, 'wolf');
    if (spot) add('wolf', spot, 1, 5);
  }
  for (let i = 0; i < 5 * travellerScale; i++) {
    const spot = pickWildSpot(map, { x: Math.floor(Math.random() * map.width), y: Math.floor(Math.random() * map.height) }, 30, 'heron');
    if (spot) add('heron', spot, 0);
  }

  return wanderers;
}

/** Step a wanderer toward its target; pick a new target on arrival. */
export function stepWanderers(wanderers: Wanderer[], map: TileMap): void {
  for (const w of wanderers) {
    if (w.speed <= 0) continue;
    if (w.tile.x === w.target.x && w.tile.y === w.target.y) {
      // Remember this spot; new targets avoid recent ground so the wanderer
      // drifts outward instead of pacing a loop between two patches.
      w.recent.push({ x: w.tile.x, y: w.tile.y });
      if (w.recent.length > 6) w.recent.shift();
      // New target: people follow roads, wildlife wanders nearby terrain.
      if (w.kind === 'traveler' || w.kind === 'merchant' || w.kind === 'pilgrim' || w.kind === 'scout') {
        const spot = pickRoadSpot(map, w.tile, 10, w.recent);
        if (spot) w.target = spot;
      } else {
        const spot = pickWildSpot(map, w.tile, 8, w.kind, w.recent);
        if (spot) w.target = spot;
      }
      continue;
    }
    const dx = Math.sign(w.target.x - w.tile.x);
    const dy = Math.sign(w.target.y - w.tile.y);
    const nx = w.tile.x + dx;
    const ny = w.tile.y + dy;
    const t = map.getTile(nx, ny);
    const isPerson = w.kind === 'traveler' || w.kind === 'merchant' || w.kind === 'guard' || w.kind === 'pilgrim' || w.kind === 'scout';
    const ok = isPerson ? isRoadTile(t) : map.isWalkable(nx, ny);
    if (ok) {
      w.tile.x = nx;
      w.tile.y = ny;
    } else {
      w.target = { ...w.tile };
    }
  }
}

/** Wildlife near the party bolts away from it. */
export function scatterWildlife(wanderers: Wanderer[], from: Vector2, radius: number): Wanderer[] {
  const spooked: Wanderer[] = [];
  for (const w of wanderers) {
    if (w.shy <= 0) continue;
    const d = Math.abs(w.tile.x - from.x) + Math.abs(w.tile.y - from.y);
    if (d <= radius) {
      const dx = w.tile.x >= from.x ? 1 : -1;
      const dy = w.tile.y >= from.y ? 1 : -1;
      w.target = { x: w.tile.x + dx * 6, y: w.tile.y + dy * 6 };
      spooked.push(w);
    }
  }
  return spooked;
}

export function isWildlife(kind: WandererKind): boolean {
  return kind === 'deer' || kind === 'rabbit' || kind === 'wolf' || kind === 'heron';
}

/** Ambient flavor lines narrated when entering a biome. */
export const BIOME_EVENTS: Record<number, string[]> = {
  [TileType.Forest]: [
    'The canopy closes overhead; birdsong gives way to rustling leaves and the creak of old branches.',
    'Sunlight dapples the trail. A fox watches from the ferns, unimpressed.',
    'The road winds between ancient trunks — the forest here has never been fully logged.',
    'A fallen oak spans a small stream, moss-covered and slick. The party crosses single-file.',
    'Shafts of light pierce the canopy, each one a pillar of gold dust and midges. It feels almost sacred.',
    'Deep in the trees, something large yawns — then all goes quiet. The forest holds its breath.',
    'A grove of young birches stands where an old logging camp used to be. Stumps ring the clearing like gravestones.',
    'The trail crosses a stream on stepping stones. A heron watches, statuesque, one eye on the water.',
  ],
  [TileType.Mountain]: [
    'Thin air and bare stone. The trail climbs past cairns left by travelers who came before.',
    'Wind howls through the pass. Far below, the world spreads out like a map.',
    'A mountain goat watches from a ledge, entirely unbothered by the climb.',
    'The path hugs a sheer drop. Loose scree skitters away underfoot, vanishing into the void.',
    'An abandoned way-shrine to a wind god stands against the cliff, its bell long silent but still swinging in the gusts.',
    'Snowfields above reflect the sun so brightly the party shades their eyes. The air tastes of ice.',
    'A smugglers\' cave mouth appears partway up the slope, half-hidden behind a fallen boulder. Something glints inside.',
    'The summit pass reveals the whole realm — forests, lakes, and distant towns reduced to a painted map.',
  ],
  [TileType.Desert]: [
    'Heat shimmers on the horizon. The road here is packed sand worn smooth by caravans.',
    'A dry wind carries the smell of dust and distant lightning.',
    'Cacti and sun-bleached bones line the trail. Somewhere ahead, an oasis is promised.',
    'A sandstorm gathers on the horizon, a brown wall of grit — it veers away at the last moment, sparing the road.',
    'The ruins of an old caravan lie half-buried: a shattered wheel, a bleached ribcage, a locked strongbox half-swallowed by dunes.',
    'Heat mirages lift the road to water. Around noon, the whole landscape seems to swim.',
    'A desert fox darts between rocks, dragging something shiny. The trail of paw prints ends at a small, cool overhang.',
    'The wind moans across a field of smooth stones carved with names. A traveler\'s cemetery, thousands of years old.',
  ],
  [TileType.Swamp]: [
    'The ground grows soft — water seeps between the road stones. Bubbles rise from the murk.',
    'Fireflies drift over the reeds. Something large splashes out of sight.',
    'Mist hangs over the water. The frogs are loud enough to cover any footsteps.',
    'A heron stands motionless in the shallows. A log nearby is — no, wait. That log just blinked.',
    'The boardwalk of an old causeway still holds, its planks slick with algae. Beneath, black water waits.',
    'A ruined chapel rises from the marsh, its bell tower leaning. Herons nest in its broken windows.',
    'Willows trail their fingers in the water. Between the trunks, a face — a trick of the fog? It is gone now.',
    'The path threads through candleberry bushes. Their waxy fruit glows faintly in the twilight, and the smell is sweet and strange.',
  ],
  [TileType.Snow]: [
    'Snow crunches underfoot. Breath fogs in the cold air of the northern wastes.',
    'The wind picks up, whipping powder across the trail. A raven rides the current.',
    'White as far as the eye can see — the road is the only dark line in the snow.',
    'A moose stands in the middle of the trail, steam pluming from its nostrils. It regards the party, then slowly steps aside.',
    'Frost patterns crawl along a fallen log, delicate as lace. In the stillness, the snow itself seems to whisper.',
    'A ruined watchtower leans over the road, its beacon-cage empty and drifted shut. Something huddles in the doorway — a fox, sleeping.',
    'The party\'s breath freezes to their scarves. Stars wheel overhead, impossibly bright this far north.',
    'A hot spring steams in a hollow, ringed by green grass and startled frogs — an emerald pocket in the white.',
  ],
  [TileType.Sand]: [
    'The shore stretches along the water — the road hugs the coast for a while.',
    'Gulls wheel overhead. The lake glitters in the sun.',
    'Driftwood sculptures, half-finished, lean against the dunes — the work of a lonely artist, perhaps.',
    'A beached rowboat rots on the sand, its name still legible: the Fairweather. It does not look like it had a fair voyage.',
    'Tiny crabs scatter sideways as the party passes. The water laps politely, as if apologizing for the cold.',
    'The sand here is white and squeaks underfoot. Far out on the water, a sail moves slowly against the wind.',
  ],
};

/** A random ambient scene, narrated occasionally while traveling. */
export function randomTravelEvent(): string {
  const events = [
    'A caravan rumbles past, its driver waving a greeting.',
    'A bard sits by the roadside, playing for an audience of three sheep.',
    'Distant thunder rolls over the hills — the sky darkens briefly, then clears.',
    'Two farmers argue about a fence while a goat eats their hats.',
    'A child runs alongside the road, trying to keep pace before giving up.',
    'A wagon wheel lies abandoned in the ditch, half-swallowed by weeds.',
    'An old soldier salutes the party as they pass. "Stay sharp," he says.',
    'A flock of birds wheels overhead, turning as one toward the mountains.',
    'Smoke rises from a farmhouse chimney; a dog barks a lazy welcome.',
    'A wandering monk in saffron robes walks in the party\'s direction for a while, speaking of the weather and the nature of storms.',
    'A tinker\'s cart creaks past, its driver singing loudly and badly. He tips his hat without missing a note.',
    'A deer crosses the road ahead, then stops to look back, as if deciding whether to warn the party about something.',
    'Two ravens argue over a scrap of bread on the road. One wins. The other swears vengeance in raven.',
    'A lone knight in dented armor rests beneath an oak, his horse grazing. He nods without saying a word.',
    'A peddler offers the party a map of "treasure beyond the hills." He seems almost disappointed when they decline.',
    'A funeral procession passes, hushed and slow. The toad-bearers exchange looks of practiced sorrow.',
    'The party passes a gallows at a crossroads. The rope sways in the breeze. A crow sits on the beam, watching.',
    'A shepherd boy waves from a hillside, then turns back to his flock, whistling a tune the party was just humming.',
    'A messenger on a lathered horse thunders past, calling out: "Make way! News from the capital!" He is gone before anyone can ask which capital.',
    'A farmer offers the party a drink of water from a skin that is, on inspection, mostly wine. He winks. "Vitamins."',
    'A group of children plays at being adventurers with stick swords. They ask the party, in all seriousness, to duel their champion.',
    'A great owl swoops low over the road and vanishes into the trees. A moment later, something answers it from farther off.',
    'A traveling dentist sets up shop by the road: one chair, one pliers, one flask of something that is probably not anesthetic.',
    'The party stops at a crossroads shrine and leaves a coin. The wind picks up, as if blessedly.',
    'A peddler of luck charms has a dozen tiny clay hands on strings. \"For good fortune,\" he says, \"and also for the road ahead.\"',
  ];
  return events[Math.floor(Math.random() * events.length)];
}
