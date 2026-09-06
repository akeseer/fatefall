/**
 * Spell components.
 *
 * A few of the great spells want something rare in the hand: a pinch of
 * phoenix ash for a column of flame, a shard of never-melting frost for the
 * cold. The party finds them in hoards and keeps them in the pack; a caster
 * without one cannot shape the spell. Pure: the table and the items.
 */

import type { InventoryItem } from '../entities/Character';

export interface Component {
  itemId: string;
  name: string;
  description: string;
}

/** Spell id to the component it consumes... or rather keeps: the pinch is not used up. */
export const SPELL_COMPONENTS: Record<string, Component> = {
  flame_strike: { itemId: 'comp_phoenix_ash', name: 'Phoenix Ash', description: 'A pinch of grey ash that is warm to the touch and always will be. A column of holy fire wants it.' },
  cone_of_cold_playable: { itemId: 'comp_rime_shard', name: 'Rime Shard', description: 'A splinter of ice that does not melt, wrapped in wool so it does not burn the hand. The cold wants it.' },
  wall_of_force: { itemId: 'comp_diamond_dust', name: 'Diamond Dust', description: 'A twist of paper with a glitter in it worth a house. A wall of nothing wants it.' },
  banishment: { itemId: 'comp_silver_bell', name: 'Silver Bell', description: 'A bell the size of a thumbnail that rings on a note only the banished hear.' },
  ice_storm: { itemId: 'comp_rime_shard', name: 'Rime Shard', description: 'A splinter of ice that does not melt, wrapped in wool so it does not burn the hand. The cold wants it.' },
};

export const COMPONENT_ITEMS: InventoryItem[] = Object.values(SPELL_COMPONENTS)
  .filter((c, i, arr) => arr.findIndex(x => x.itemId === c.itemId) === i)
  .map(c => ({ id: c.itemId, name: c.name, type: 'treasure', description: c.description, value: 60, rarity: 'rare' }));

/** The component a spell wants, if any. */
export function componentFor(spellId: string): Component | undefined {
  return SPELL_COMPONENTS[spellId];
}
