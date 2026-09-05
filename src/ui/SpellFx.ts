/**
 * What every spell looks and sounds like on the battlefield.
 *
 * One entry per spell in the spell table: how it is delivered (a bolt that
 * crosses the field, a burst on the target, a wash over everyone, a change
 * to the caster), the motif the battle window draws for it, the element that
 * colours it, and the sound that goes with it. A spell missing from this
 * table still gets a generic effect from its element, but the test insists
 * nothing is missing, so a new spell in the data has to be given its look.
 */

import type { Element } from './BattleFx';

/** The shapes the battle window knows how to draw. */
export type SpellMotif =
  /** A bolt from caster to target, then the element lands. */
  | 'bolt'
  /** Three small darts. */
  | 'darts'
  /** Three bolts in a row. */
  | 'rays'
  /** The element lands on the target with no travel. */
  | 'burst'
  /** The element on every foe, near to far, with a field flash. */
  | 'aoe'
  /** Flames rolling from the caster over every foe. */
  | 'cone'
  /** A column of light from above on the target. */
  | 'column'
  /** Lightning from the sky on every foe. */
  | 'skyzap'
  /** One great streak across the enemy ranks. */
  | 'zapline'
  /** A ring of force from the caster, and a shake. */
  | 'wave'
  /** A glowing weapon dropping on the target. */
  | 'hammer'
  /** A vine or lash from caster to target. */
  | 'lash'
  /** The caster vanishes and reappears. */
  | 'blink'
  /** Ghostly copies of the caster. */
  | 'ghosts'
  /** The target fades to a shimmer. */
  | 'fade'
  /** The target lifts and hovers. */
  | 'float'
  /** Rotating rings over the foes. */
  | 'spiral'
  /** Motes orbiting the caster. */
  | 'orbit'
  /** Rising motes on the whole party. */
  | 'motes_party'
  /** A hex ward around the target. */
  | 'ward'
  /** A ring closing in on the target: something being cancelled. */
  | 'counter'
  /** The field goes dark. */
  | 'dark'
  /** Zs on every foe. */
  | 'sleep_all'
  /** Vines or chains on the target. */
  | 'vines'
  /** Vines on every foe. */
  | 'vines_all'
  /** A crosshair on the target. */
  | 'mark'
  /** The caster's weapon glows. */
  | 'weapon_glow'
  /** A handful of tiny stars. */
  | 'sparkle'
  /** Drifting lights. */
  | 'lights'
  /** A heavy wash and a sag: the target slowed. */
  | 'heavy'
  /** A word that hurts: a psychic ripple and a jeer. */
  | 'mock'
  /** Dark wisps drawn from the target to the caster, who is mended. */
  | 'drain'
  /** Rising healing motes on the target. */
  | 'heal'
  /** A translucent pane across the middle of the field. */
  | 'wall'
  /** The target is pulled out of the world and back. */
  | 'banish'
  /** The target shrinks into a puff and swells back. */
  | 'polymorph'
  /** Shards falling from above across the foes. */
  | 'storm'
  /** A glowing ring under the party. */
  | 'circle'
  /** Flames clinging to the caster. */
  | 'fire_shield'
  /** A glowing aura on the target: a blessing or a curse. */
  | 'aura';

export type SpellSound =
  | 'fire' | 'shock' | 'arcane' | 'heal' | 'cold' | 'thunder' | 'necrotic' | 'radiant' | 'psychic' | 'poison' | 'acid' | 'force'
  | 'bolt' | 'darts' | 'shield' | 'bless' | 'haste' | 'sleep' | 'afflict' | 'legendary' | 'roar' | 'dissolve' | 'mark'
  | 'blink' | 'hammer' | 'lash' | 'sparkle' | 'counter' | 'mock' | 'web' | 'warble' | 'wall' | 'storm' | 'fizzle' | 'chant' | 'flames';

export interface SpellFx {
  motif: SpellMotif;
  element: Element;
  sound: SpellSound;
  /** Who it is drawn on: the named target, every foe, the caster, or the whole party. */
  on: 'target' | 'foes' | 'self' | 'party' | 'field';
}

/** Keys are spell names, lower-cased. */
export const SPELL_FX: Record<string, SpellFx> = {
  // Cantrips and 1st level
  'fire bolt': { motif: 'bolt', element: 'fire', sound: 'fire', on: 'target' },
  'sacred flame': { motif: 'column', element: 'radiant', sound: 'radiant', on: 'target' },
  'eldritch blast': { motif: 'bolt', element: 'force', sound: 'force', on: 'target' },
  'guidance': { motif: 'aura', element: 'radiant', sound: 'chant', on: 'target' },
  'magic missile': { motif: 'darts', element: 'force', sound: 'darts', on: 'target' },
  'cure wounds': { motif: 'heal', element: 'heal', sound: 'heal', on: 'target' },
  'bless': { motif: 'motes_party', element: 'radiant', sound: 'bless', on: 'party' },
  'shield': { motif: 'ward', element: 'force', sound: 'shield', on: 'self' },
  'burning hands': { motif: 'cone', element: 'fire', sound: 'flames', on: 'foes' },
  'healing word': { motif: 'heal', element: 'heal', sound: 'heal', on: 'target' },
  'chill touch': { motif: 'bolt', element: 'necrotic', sound: 'necrotic', on: 'target' },
  'vicious mockery': { motif: 'mock', element: 'psychic', sound: 'mock', on: 'target' },
  'thunderwave': { motif: 'wave', element: 'thunder', sound: 'thunder', on: 'foes' },
  'chromatic orb': { motif: 'bolt', element: 'arcane', sound: 'bolt', on: 'target' },
  'inflict wounds': { motif: 'burst', element: 'necrotic', sound: 'necrotic', on: 'target' },
  'poison spray': { motif: 'cone', element: 'poison', sound: 'poison', on: 'target' },
  'ray of frost': { motif: 'bolt', element: 'cold', sound: 'cold', on: 'target' },
  'prestidigitation': { motif: 'sparkle', element: 'arcane', sound: 'sparkle', on: 'self' },
  'minor illusion': { motif: 'ghosts', element: 'arcane', sound: 'sparkle', on: 'self' },
  'dancing lights': { motif: 'lights', element: 'radiant', sound: 'sparkle', on: 'field' },
  'resistance': { motif: 'aura', element: 'force', sound: 'chant', on: 'target' },
  'spare the dying': { motif: 'heal', element: 'heal', sound: 'heal', on: 'target' },
  'thorn whip': { motif: 'lash', element: 'poison', sound: 'lash', on: 'target' },
  'produce flame': { motif: 'bolt', element: 'fire', sound: 'fire', on: 'target' },
  'shillelagh': { motif: 'weapon_glow', element: 'poison', sound: 'chant', on: 'self' },
  'true strike': { motif: 'mark', element: 'radiant', sound: 'mark', on: 'target' },
  'word of radiance': { motif: 'aoe', element: 'radiant', sound: 'radiant', on: 'foes' },
  'shield of faith': { motif: 'ward', element: 'radiant', sound: 'shield', on: 'target' },
  'faerie fire': { motif: 'aoe', element: 'psychic', sound: 'sparkle', on: 'foes' },
  'armor of agathys': { motif: 'fire_shield', element: 'cold', sound: 'cold', on: 'self' },
  'hex': { motif: 'mark', element: 'necrotic', sound: 'necrotic', on: 'target' },
  'entangle': { motif: 'vines_all', element: 'poison', sound: 'web', on: 'foes' },
  'sanctuary': { motif: 'circle', element: 'radiant', sound: 'chant', on: 'target' },

  // 2nd level
  'spiritual weapon': { motif: 'hammer', element: 'force', sound: 'hammer', on: 'target' },
  'misty step': { motif: 'blink', element: 'arcane', sound: 'blink', on: 'self' },
  'hold person': { motif: 'vines', element: 'arcane', sound: 'afflict', on: 'target' },
  'scorching ray': { motif: 'rays', element: 'fire', sound: 'fire', on: 'target' },
  'shatter': { motif: 'wave', element: 'thunder', sound: 'thunder', on: 'foes' },
  'moonbeam': { motif: 'column', element: 'radiant', sound: 'radiant', on: 'target' },
  'invisibility': { motif: 'fade', element: 'arcane', sound: 'blink', on: 'target' },
  'mirror image': { motif: 'ghosts', element: 'arcane', sound: 'sparkle', on: 'self' },
  'web': { motif: 'vines_all', element: 'arcane', sound: 'web', on: 'foes' },
  'aid': { motif: 'motes_party', element: 'heal', sound: 'bless', on: 'party' },
  'darkness': { motif: 'dark', element: 'necrotic', sound: 'necrotic', on: 'field' },

  // 3rd level
  'fireball': { motif: 'aoe', element: 'fire', sound: 'fire', on: 'foes' },
  'lightning bolt': { motif: 'zapline', element: 'lightning', sound: 'shock', on: 'foes' },
  'vampiric touch': { motif: 'drain', element: 'necrotic', sound: 'necrotic', on: 'target' },
  'call lightning': { motif: 'skyzap', element: 'lightning', sound: 'shock', on: 'foes' },
  'remove curse': { motif: 'counter', element: 'radiant', sound: 'fizzle', on: 'target' },
  'counterspell': { motif: 'counter', element: 'arcane', sound: 'counter', on: 'target' },
  'haste': { motif: 'aura', element: 'lightning', sound: 'haste', on: 'target' },
  'slow': { motif: 'heavy', element: 'cold', sound: 'warble', on: 'target' },
  'hypnotic pattern': { motif: 'spiral', element: 'psychic', sound: 'warble', on: 'foes' },
  'stinking cloud': { motif: 'aoe', element: 'poison', sound: 'poison', on: 'foes' },
  'spirit guardians': { motif: 'orbit', element: 'radiant', sound: 'chant', on: 'self' },
  'fly': { motif: 'float', element: 'arcane', sound: 'haste', on: 'target' },
  'bestow curse': { motif: 'aura', element: 'necrotic', sound: 'afflict', on: 'target' },
  'dispel magic': { motif: 'counter', element: 'arcane', sound: 'fizzle', on: 'target' },

  // 4th level and up
  'blight': { motif: 'drain', element: 'necrotic', sound: 'necrotic', on: 'target' },
  'cone of cold': { motif: 'cone', element: 'cold', sound: 'cold', on: 'foes' },
  'greater invisibility': { motif: 'fade', element: 'arcane', sound: 'blink', on: 'target' },
  'fire shield': { motif: 'fire_shield', element: 'fire', sound: 'flames', on: 'self' },
  'banishment': { motif: 'banish', element: 'arcane', sound: 'counter', on: 'target' },
  'ice storm': { motif: 'storm', element: 'cold', sound: 'storm', on: 'foes' },
  'dimension door': { motif: 'blink', element: 'arcane', sound: 'blink', on: 'self' },
  'polymorph': { motif: 'polymorph', element: 'arcane', sound: 'warble', on: 'target' },
  'wall of force': { motif: 'wall', element: 'force', sound: 'wall', on: 'field' },
  'banishing smite': { motif: 'column', element: 'radiant', sound: 'radiant', on: 'target' },
  'flame strike': { motif: 'column', element: 'fire', sound: 'flames', on: 'target' },
  'circle of power': { motif: 'circle', element: 'radiant', sound: 'chant', on: 'party' },
};

/** The look of a spell by name, or null for one the table has never heard of. */
export function spellFxFor(name: string): SpellFx | null {
  return SPELL_FX[name.trim().toLowerCase()] ?? null;
}
