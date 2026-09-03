/**
 * Distinct room features — altars, vaults, prisons, chokepoints, forges,
 * libraries, fountains, sarcophagi, thrones.
 *
 * Each dungeon room can carry one feature. It is narrated when the party
 * first enters the room and can be interacted with through DM commands
 * ("pray at the altar", "search the vault", "barricade the chokepoint"...).
 * Effects live in main.ts; this module is the data + placement logic.
 */

import { Room } from './DungeonGenerator';

export type RoomFeatureKind =
  | 'altar' | 'vault' | 'prison' | 'chokepoint' | 'forge'
  | 'library' | 'fountain' | 'sarcophagus' | 'throne'
  | 'trapped_corridor' | 'treasure_room' | 'merchant_camp'
  | 'puzzle_room' | 'ritual_chamber' | 'war_room' | 'chest';

export interface RoomFeature {
  id: string;
  kind: RoomFeatureKind;
  /** Short title, e.g. "a rusted altar to a forgotten god". */
  name: string;
  /** Full sentence narrated when the party first enters the room. */
  entryLine: string;
  /** Flavor for generic "search the room" / inspect interactions. */
  inspect: string;
  /** The feature's one big interaction has been spent. */
  used: boolean;
  /** Chokepoints can be barricaded, granting +1 AC to the next fights here. */
  barricaded?: boolean;
  /** Chests only: a stuck lid the party must force before it opens. */
  locked?: boolean;
  /** Chests only: the lid is wired to a trap that has not gone off yet. */
  trapped?: boolean;
  /**
   * Chests only: it is not a chest at all. A mimic wears no lock and no trap
   * — it wants to be opened — so this is never set alongside those two. It
   * stays set after the thing springs, which is how an emptied room knows to
   * describe splinters and glue instead of an open lid.
   */
  mimic?: boolean;
}

interface FeatureVariant {
  name: string;
  entryLine: string;
  inspect: string;
}

const VARIANTS: Record<RoomFeatureKind, FeatureVariant[]> = {
  altar: [
    {
      name: 'a rusted altar to a forgotten god',
      entryLine: 'A rusted altar to a forgotten god dominates the far wall, its candle still burning after all these years.',
      inspect: 'Graven symbols spiral across the altar stone — someone has been leaving offerings here recently.',
    },
    {
      name: 'a shattered shrine to Lathander',
      entryLine: 'A shattered shrine to Lathander stands in the corner, dawn-hammer cracked but the sunrise motes still drifting in the air.',
      inspect: 'Broken vessels and faded sunbursts litter the shrine. A small censor of incense still smokes.',
    },
    {
      name: 'a blood-stained sacrificial table',
      entryLine: 'A blood-stained sacrificial table squats at the room\'s heart, old runoff crusted dark in the runnels.',
      inspect: 'The table is carved with binding circles. You feel watched while you stand near it.',
    },
  ],
  vault: [
    {
      name: 'a sealed iron vault',
      entryLine: 'A sealed iron vault is set into the wall, its lock a tangle of corroded teeth.',
      inspect: 'The vault door is thick and cold. Something heavy shifts behind it when you knock.',
    },
    {
      name: 'a collapsed strongbox',
      entryLine: 'A collapsed strongbox lies half-buried in rubble, its lid sprung and spilling dark cloth.',
      inspect: 'The strongbox\'s hinges are broken — whatever guarded it has been gone a long time.',
    },
  ],
  prison: [
    {
      name: 'a row of rusted prison cells',
      entryLine: 'A row of rusted prison cells lines one wall, each door hanging crooked on its hinges.',
      inspect: 'Most cells are empty. A single pair of eyes glints back at you from the deepest one.',
    },
    {
      name: 'a cage of old bones',
      entryLine: 'A cage of old bones hangs from the ceiling, its door swung wide and its floor drifted with dust.',
      inspect: 'The cage door creaks. A torn scrap of cloth is knotted to the bars — a prisoner\'s message, long unread.',
    },
  ],
  chokepoint: [
    {
      name: 'a natural chokepoint',
      entryLine: 'The passage narrows to a natural chokepoint — one defender could hold this gap against many.',
      inspect: 'Fallen masonry offers ready cover. Anything coming through that gap would have to come one at a time.',
    },
    {
      name: 'a barricade-ready doorway',
      entryLine: 'A barricade-ready doorway frames the far exit — notches in the stone show where beams have been set before.',
      inspect: 'Scattered timbers and a pry bar sit nearby, as if someone planned to hold this line and never did.',
    },
  ],
  forge: [
    {
      name: 'a cold forge with a still-warm anvil',
      entryLine: 'A cold forge squats against the wall, but the anvil is still warm — someone worked here within the hour.',
      inspect: 'Hammers, tongs, and a whetstone hang in reach. A half-finished blade rests in the cooling trough.',
    },
    {
      name: 'a long-abandoned smithy',
      entryLine: 'A long-abandoned smithy fills the room with the ghost of old smoke, the bellows frozen mid-breath.',
      inspect: 'The bellows are cracked and the coals long cold, but the grinding wheel still turns true.',
    },
  ],
  library: [
    {
      name: 'a collapsed library of mildewed tomes',
      entryLine: 'A collapsed library of mildewed tomes spills from sagging shelves, pages curling on the floor.',
      inspect: 'Most of the books are unreadable rot, but a few spines gleam with intact leather and faded gilt titles.',
    },
    {
      name: 'a lectern with a chained grimoire',
      entryLine: 'A lectern stands alone in the room\'s center, a chained grimoire open to a page of precise diagrams.',
      inspect: 'The diagrams show a circle of summoning — and a warning, underlined twice, in a shaking hand.',
    },
  ],
  fountain: [
    {
      name: 'a dry fountain with a trickling basin',
      entryLine: 'A dry fountain stands in the middle of the room, though a thin trickle still drips into its basin.',
      inspect: 'The water is clear and cold. Old coins glint at the bottom — wishes that were never spent.',
    },
    {
      name: 'a mossy cistern',
      entryLine: 'A mossy cistern brims with dark water at the room\'s edge, its surface barely stirring.',
      inspect: 'The cistern is deep and quiet. Something pale drifts just beneath the surface.',
    },
  ],
  sarcophagus: [
    {
      name: 'a sealed stone sarcophagus',
      entryLine: 'A sealed stone sarcophagus rests on a low dais, its lid carved with a face that seems to be listening.',
      inspect: 'The lid is heavy but movable. The name carved beneath the face is in no alphabet you recognize.',
    },
    {
      name: 'a row of child-sized tombs',
      entryLine: 'A row of child-sized tombs runs along the wall, each lid bolted down with fresh iron.',
      inspect: 'The bolts are new and the seals unbroken. Something scratches faintly within the middle one.',
    },
  ],
  throne: [
    {
      name: 'a throne of fused stone',
      entryLine: 'A throne of fused stone rises at the room\'s far end, its arms worn smooth by a hundred vanished hands.',
      inspect: 'The throne is cold and ordinary now — but a crown-shaped recess sits in the armrest, empty.',
    },
    {
      name: 'a dais with a single empty chair',
      entryLine: 'A dais with a single empty chair stands at the room\'s head, the chair still turned to face the door.',
      inspect: 'Someone has sat here recently — the dust is disturbed, and a single gold coin lies at the chair\'s foot.',
    },
  ],
  trapped_corridor: [
    {
      name: 'a narrow corridor studded with pressure plates',
      entryLine: 'The corridor ahead is riddled with pressure plates and tripwires — a gauntlet of death.',
      inspect: 'A careful eye reveals hair-thin wires strung between the walls and barely-visible pressure plates in the stone.',
    },
    {
      name: 'a hallway lined with dart holes',
      entryLine: 'Hundreds of tiny holes line the walls — this corridor has been turning intruders into pincushions for centuries.',
      inspect: 'The dart holes are staggered in a pattern. Some still hold rusted bolts; others are freshly loaded.',
    },
  ],
  treasure_room: [
    {
      name: 'a room heaped with glittering coin',
      entryLine: 'Gold coins, gemstones, and art objects overflow from rotting chests — someone hoarded a fortune here.',
      inspect: 'Most of the gold is copper coins plated in gold leaf. The gemstones, however, are real — and very valuable.',
    },
    {
      name: 'a vault with crystal-display cases',
      entryLine: 'Crystal cases hold enchanted weapons and armor, each illuminated by a slow-pulsing magical light.',
      inspect: 'The cases are locked with arcane mechanisms. Breaking one would trigger a defensive ward.',
    },
  ],
  merchant_camp: [
    {
      name: 'a merchant camp with a weary trader',
      entryLine: 'A lantern illuminates a small camp — a dwarf merchant sits on crates, counting coin and looking exhausted.',
      inspect: 'The merchant has potions, scrolls, and oddities for sale. He looks like he has been down here for weeks.',
    },
    {
      name: 'a abandoned camp with fresh provisions',
      entryLine: 'An abandoned camp with half-eaten rations and a smoldering fire. Someone left in a hurry.',
      inspect: 'Boot prints lead to the northeast corridor. A bloodstained map lies half-buried in the ash.',
    },
  ],
  puzzle_room: [
    {
      name: 'a room with a massive stone puzzle',
      entryLine: 'A giant stone puzzle dominates the floor — rotating rings inscribed with runes that must be aligned.',
      inspect: 'The rings have three positions each. Aligning all rings to show the same rune opens a hidden door.',
    },
    {
      name: 'a chamber with pressure-tile floor',
      entryLine: 'The entire floor is a grid of colored tiles, each slightly raised. Step wrong and the ceiling begins to descend.',
      inspect: 'The safe path follows a specific color pattern. The tiles glow faintly when stepped on.',
    },
  ],
  ritual_chamber: [
    {
      name: 'a pentagram carved into the floor',
      entryLine: 'A massive pentagram is carved into the stone floor, still faintly glowing with residual magic.',
      inspect: 'The pentagram channels planar energy. A wizard could use it to scry, summon, or open a portal.',
    },
    {
      name: 'a chamber of floating candles',
      entryLine: 'Hundreds of candles float in the air, arranged in a spiraling helix. The flame colors shift with an unseen rhythm.',
      inspect: 'The candles are enchanted to burn eternally. A prayer here could restore spell slots.',
    },
  ],
  war_room: [
    {
      name: 'a war room with maps and battle plans',
      entryLine: 'Maps cover every wall, marked with red pins and crossed swords — this was a command center.',
      inspect: 'The maps show troop positions and supply routes. Studying them reveals shortcuts and hidden passages.',
    },
    {
      name: 'an armory with weapon racks',
      entryLine: 'Weapon racks line the walls, most empty but a few still hold serviceable blades and shields.',
      inspect: 'The weapons are old but well-maintained. Someone has been sharpening them recently.',
    },
  ],
  chest: [
    {
      name: 'an iron-bound chest',
      entryLine: 'An iron-bound chest squats in the corner, its lid furred with dust nobody has disturbed in years.',
      inspect: 'The bands are rusted but the wood beneath is sound. Whatever is inside has been waiting a long time.',
    },
    {
      name: 'a small brass coffer',
      entryLine: 'A small brass coffer sits on a toppled plinth, catching what little light there is.',
      inspect: 'The brass is tarnished green. Something shifts inside when the floor is disturbed.',
    },
    {
      name: 'a strongbox under a fallen beam',
      entryLine: 'A strongbox lies half-crushed beneath a fallen beam, its corner split open.',
      inspect: 'The split is just wide enough to see coin edges glinting inside. The beam will need shifting.',
    },
    {
      name: 'a lacquered chest bound in silver wire',
      entryLine: 'A lacquered chest bound in silver wire rests against the wall, entirely free of dust.',
      inspect: 'Not a speck of dust on it, in a room thick with the stuff. Someone left this here recently, or it is not what it appears.',
    },
    {
      name: 'a warped travelling trunk',
      entryLine: 'A travelling trunk lies on its side, warped by damp, one hinge sprung.',
      inspect: 'Someone dragged this a long way and then never came back for it.',
    },
  ],
};

/** Pick a random variant for a kind. */
function pickVariant(kind: RoomFeatureKind): FeatureVariant {
  const list = VARIANTS[kind];
  return list[Math.floor(Math.random() * list.length)];
}

/** Which features are likely where: benign in the start room, martial at the boss. */
const START_KINDS: RoomFeatureKind[] = ['fountain', 'altar', 'throne', 'library', 'merchant_camp', 'chest'];
const BOSS_KINDS: RoomFeatureKind[] = ['vault', 'throne', 'chokepoint', 'ritual_chamber', 'war_room', 'chest'];
const GENERAL_KINDS: RoomFeatureKind[] = [
  'altar', 'vault', 'prison', 'chokepoint', 'forge',
  'library', 'fountain', 'sarcophagus', 'throne',
  'trapped_corridor', 'treasure_room', 'merchant_camp',
  'puzzle_room', 'ritual_chamber', 'war_room',
  // Chests are the common find, so they are weighted heavier than the rest.
  'chest', 'chest', 'chest',
];

let featureCounter = 0;

export function assignFeature(
  room: Room,
  dungeonLevel: number,
  opts?: { start?: boolean; boss?: boolean; force?: boolean }
): RoomFeature | undefined {
  // Old saves restore rooms with no feature — `force` gives them one.
  if (!opts?.force && !opts?.start && !opts?.boss && Math.random() < 0.2) return undefined;

  let pool = GENERAL_KINDS;
  if (opts?.start) pool = START_KINDS;
  else if (opts?.boss) pool = BOSS_KINDS;
  // Deeper floors lean toward danger and riches.
  else if (dungeonLevel >= 3) pool = [...GENERAL_KINDS, 'vault', 'prison', 'sarcophagus'];

  const kind = pool[Math.floor(Math.random() * pool.length)];
  const variant = pickVariant(kind);
  const feature: RoomFeature = {
    id: `feature_${++featureCounter}_${room.cx}_${room.cy}`,
    kind,
    name: variant.name,
    entryLine: variant.entryLine,
    inspect: variant.inspect,
    used: false,
  };
  if (kind === 'chest') {
    // Deeper floors guard their chests better.
    feature.locked = Math.random() < 0.35;
    feature.trapped = Math.random() < Math.min(0.45, 0.12 + dungeonLevel * 0.05);
    // ...and deeper floors are likelier to be lying about the chest entirely.
    // A mimic is bait, so it wears neither lock nor trap: the lid it shows
    // the party always opens on the first try, which is the whole trick.
    feature.mimic = Math.random() < Math.min(0.22, 0.06 + dungeonLevel * 0.03);
    if (feature.mimic) {
      feature.locked = false;
      feature.trapped = false;
    }
  }
  room.feature = feature;
  return feature;
}

/** Assign a feature to every room of a freshly generated dungeon. */
export function assignFeaturesToRooms(rooms: Room[], dungeonLevel: number): void {
  featureCounter = 0;
  for (let i = 0; i < rooms.length; i++) {
    assignFeature(rooms[i], dungeonLevel, {
      start: i === 0,
      boss: i === rooms.length - 1,
    });
  }
}
