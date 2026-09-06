/**
 * Wild magic surges.
 *
 * A sorcerer's spell sometimes gets away from them. Twenty results, some
 * of them a mechanical effect the engine applies and some of them only a
 * thing that happens, which is the tradition. Pure: a table and a roll.
 */

export type SurgeEffect =
  | { kind: 'heal_party'; dice: [number, number] }
  | { kind: 'heal_self'; dice: [number, number] }
  | { kind: 'burn_self'; dice: [number, number] }
  | { kind: 'burn_foe'; dice: [number, number] }
  | { kind: 'burn_all_foes'; dice: [number, number] }
  | { kind: 'bless'; rounds: number }
  | { kind: 'none' };

export interface Surge {
  roll: number;
  text: string;
  effect: SurgeEffect;
}

const TABLE: { text: string; effect: SurgeEffect }[] = [
  { text: 'A wash of warm light rolls out from {name}; every ally feels their wounds close a little.', effect: { kind: 'heal_party', dice: [1, 8] } },
  { text: '{name} is briefly, entirely, on fire.', effect: { kind: 'burn_self', dice: [1, 6] } },
  { text: 'A bolt of something leaps from {name}\'s hand into the nearest enemy, uninvited.', effect: { kind: 'burn_foe', dice: [2, 6] } },
  { text: 'The floor under every enemy remembers being lava.', effect: { kind: 'burn_all_foes', dice: [1, 6] } },
  { text: 'For three rounds the party\'s weapons hum with a luck {name} did not intend to spend.', effect: { kind: 'bless', rounds: 3 } },
  { text: '{name}\'s hair turns white. It will grow back, probably.', effect: { kind: 'none' } },
  { text: 'Every torch in the room burns blue for a moment. Nothing else happens. Everyone waits. Nothing else happens.', effect: { kind: 'none' } },
  { text: '{name} hears, distinctly, their own name spoken from very far away.', effect: { kind: 'none' } },
  { text: 'A small, confused pig appears at {name}\'s feet, looks at the fight, and leaves.', effect: { kind: 'none' } },
  { text: '{name} is healed by something that felt like being sneezed on.', effect: { kind: 'heal_self', dice: [2, 8] } },
  { text: 'It rains, indoors, on {name} only, for one round.', effect: { kind: 'none' } },
  { text: 'A sound like a bell the size of a house, from nowhere, and every enemy flinches.', effect: { kind: 'burn_all_foes', dice: [1, 4] } },
  { text: '{name}\'s spell comes out twice as loud and half as polite: the nearest foe takes the brunt.', effect: { kind: 'burn_foe', dice: [3, 6] } },
  { text: 'For a moment everyone in the room can see through everyone else. Nobody enjoys it.', effect: { kind: 'none' } },
  { text: '{name} turns, briefly, into a version of themself that is thirty years older and very tired. It passes.', effect: { kind: 'burn_self', dice: [1, 4] } },
  { text: 'A hundred butterflies, then nothing. The party will find them in their packs for days.', effect: { kind: 'none' } },
  { text: 'The magic goes back into {name} the wrong way, and they feel much better than they should.', effect: { kind: 'heal_self', dice: [3, 8] } },
  { text: 'Every ally\'s next blow lands a little truer, for reasons nobody can explain.', effect: { kind: 'bless', rounds: 2 } },
  { text: '{name} speaks in a voice not their own for the rest of the fight. It is a very good voice.', effect: { kind: 'none' } },
  { text: 'The spell simply works, very well, and {name} is more unsettled by this than by anything on the list.', effect: { kind: 'burn_foe', dice: [2, 8] } },
];

export const WILD_MAGIC_TABLE_SIZE = TABLE.length;

/** One surge, from a d20 `roll` (1–20). */
export function surgeFor(roll: number, casterName: string): Surge {
  const i = Math.max(0, Math.min(TABLE.length - 1, roll - 1));
  const e = TABLE[i];
  return { roll, text: `🌀 Wild magic! ${e.text.replace(/\{name\}/g, casterName)}`, effect: e.effect };
}
