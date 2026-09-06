/**
 * Road events: the wilds are not only ambushes.
 *
 * Between towns the party meets caravans, pilgrims, toll-takers, rivals and
 * the weather. Each event is picked here from the state of the road (pure)
 * and describes itself in terms `Game` can apply: a payment, a blessing, a
 * saving throw for everyone, a band that demands a toll.
 */

export type RoadEventKind =
  | 'caravan'
  | 'pilgrims'
  | 'toll_bridge'
  | 'storm_shelter'
  | 'rival_party'
  | 'lost_traveller';

export interface RoadContext {
  /** The party's gold on hand. */
  gold: number;
  partyLevel: number;
  /** Weather type id, e.g. "heavy_rain", or null for clear. */
  weather: string | null;
  isSacredDay: boolean;
  /** True near a town: caravans and pilgrims walk there; toll-takers do not. */
  nearTown: boolean;
  /** Members below half health, for the caravan's physician to matter. */
  woundedCount: number;
}

export type RoadEffect =
  /** Pay `cost`; if affordable, everyone regains `heal` dice. */
  | { kind: 'physician'; cost: number; heal: [count: number, sides: number] }
  /** A blessing: attack bonus for `fights` fights. */
  | { kind: 'blessing'; attack: number; fights: number }
  /** A band that names a toll; the parley system handles what follows. */
  | { kind: 'toll'; band: 'bandits' }
  /** Everyone saves on `ability` vs `dc` or takes `damage`. */
  | { kind: 'exposure'; ability: 'con'; dc: number; damage: [count: number, sides: number] }
  /** A contest: the leader's best of `abilities` vs `dc`; win `gold` and `xp`, or lose `lossGold`. */
  | { kind: 'contest'; abilities: ('str' | 'cha' | 'dex')[]; dc: number; gold: number; xp: number; lossGold: number }
  /** Escort: a small reward on arrival at the next town. */
  | { kind: 'gift'; gold: number; xp: number };

export interface RoadEvent {
  kind: RoadEventKind;
  /** Lines for the log as the party meets it. */
  lines: string[];
  effect: RoadEffect;
  /** What is said when it goes well / badly; {name} is the leader. */
  pass?: string;
  fail?: string;
}

const STORMS = new Set(['heavy_rain', 'sandstorm', 'blizzard', 'snow', 'thunderstorm']);

/** Base odds of any event on a road step; the caller multiplies by its own mood. */
export const ROAD_EVENT_CHANCE = 0.012;

/**
 * Pick what the road holds, or null for nothing. `rng` decides both whether
 * and which; the weather and the nearness of a town shape the odds.
 */
export function rollRoadEvent(ctx: RoadContext, rng: () => number = Math.random): RoadEvent | null {
  if (rng() > ROAD_EVENT_CHANCE) return null;
  const weights: [RoadEventKind, number][] = [
    ['caravan', ctx.nearTown ? 3 : 1.5],
    ['pilgrims', (ctx.nearTown ? 2 : 1) * (ctx.isSacredDay ? 2 : 1)],
    ['toll_bridge', ctx.nearTown ? 0.5 : 2],
    ['storm_shelter', ctx.weather && STORMS.has(ctx.weather) ? 4 : 0],
    ['rival_party', 1.5],
    ['lost_traveller', 1.5],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  let kind: RoadEventKind = 'caravan';
  for (const [k, w] of weights) { r -= w; if (r <= 0) { kind = k; break; } }
  return describe(kind, ctx);
}

export function describe(kind: RoadEventKind, ctx: RoadContext): RoadEvent {
  switch (kind) {
    case 'caravan': {
      const cost = 10 + ctx.partyLevel * 2;
      return {
        kind,
        lines: [
          '🐴 A merchant caravan comes up the road behind the party, four wagons and a dog that hates everyone equally.',
          ctx.woundedCount > 0
            ? `The caravan's physician looks the party over and names a price for hot food, clean water and a proper dressing of wounds: ${cost} gold.`
            : `The caravan master offers hot food and clean water for ${cost} gold, and news of the road for free.`,
        ],
        effect: { kind: 'physician', cost, heal: [1, 8] },
        pass: 'The party eats sitting down for the first time in days. The wagons roll on ahead, and the dog looks back once, disappointed.',
        fail: 'The party has not the coin. The caravan master shrugs and leaves a loaf on the roadside anyway, which is more than most would.',
      };
    }
    case 'pilgrims':
      return {
        kind,
        lines: [
          '🕯 A line of pilgrims comes the other way, barefoot, singing something old. Their leader stops the party and asks to bless their weapons.',
          ctx.isSacredDay ? 'It is a holy day, and the blessing has weight to it.' : 'It costs nothing, and it would be rude to refuse.',
        ],
        effect: { kind: 'blessing', attack: ctx.isSacredDay ? 2 : 1, fights: ctx.isSacredDay ? 3 : 2 },
        pass: 'The steel hums a little in the hand for a while after. Probably imagination.',
      };
    case 'toll_bridge':
      return {
        kind,
        lines: ['🌉 The road crosses a river on a bridge that someone has decided is theirs. Armed figures step out at both ends.'],
        effect: { kind: 'toll', band: 'bandits' },
      };
    case 'storm_shelter':
      return {
        kind,
        lines: ['⛈ The weather turns in earnest, and there is no shelter for a mile in any direction. The party walks through it.'],
        effect: { kind: 'exposure', ability: 'con', dc: 11 + Math.floor(ctx.partyLevel / 3), damage: [1, 4] },
        pass: '{name} keeps everyone moving and no one is lost to the cold.',
        fail: 'The storm takes its toll. They walk on shivering.',
      };
    case 'rival_party':
      return {
        kind,
        lines: [
          '⚔ Another band of adventurers is camped at the crossroads: better armour, worse manners. They are heading the same way the party is.',
          'Their leader proposes a contest for the right of way, and for a purse. The party does not want to know what they do to people who refuse.',
        ],
        effect: { kind: 'contest', abilities: ['str', 'cha', 'dex'], dc: 12 + Math.floor(ctx.partyLevel / 2), gold: 20 + ctx.partyLevel * 5, xp: 30, lossGold: Math.min(ctx.gold, 10 + ctx.partyLevel * 3) },
        pass: '{name} wins it clean. The rivals pay up sour and take the other road.',
        fail: '{name} loses, narrowly, and the rivals are gracious about it in the most irritating way possible. The purse goes with them.',
      };
    case 'lost_traveller':
      return {
        kind,
        lines: [
          '🎒 A traveller sits on a milestone with a broken sandal and a story about a wrong turn three days ago. They ask to walk with the party as far as the next town.',
          'They are no trouble, know two good songs, and pay in coin when the walls come in sight.',
        ],
        effect: { kind: 'gift', gold: 8 + ctx.partyLevel * 2, xp: 15 },
      };
  }
}
