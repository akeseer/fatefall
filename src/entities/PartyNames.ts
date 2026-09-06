/**
 * Party names with a theme to them: a company, a fellowship, a warband,
 * named for a thing the party has or a thing it fears. Pure and seeded.
 */

const ADJ = ['Iron', 'Silver', 'Broken', 'Last', 'Grey', 'Bright', 'Black', 'Red', 'Hollow', 'Wandering', 'Quiet', 'Golden', 'Sundered', 'Salt', 'Winter', 'Ember', 'Crooked', 'Merry', 'Bitter', 'Fated'];
const NOUN = ['Lantern', 'Blade', 'Crow', 'Wolf', 'Compass', 'Coin', 'Oath', 'Candle', 'Key', 'Banner', 'Die', 'Road', 'Hearth', 'Anvil', 'Thorn', 'Hound', 'Bell', 'Kettle', 'Crown', 'Star'];
const FORM = ['Company', 'Fellowship', 'Warband', 'Brigade', 'Covenant', 'Wardens', 'Circle', 'Society', 'Free Company', 'Coterie'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A name from a seed, so the same seed gives the same name. */
export function partyNameFrom(seed: string): string {
  const h = hash(seed);
  const adj = ADJ[h % ADJ.length];
  const noun = NOUN[(h >>> 5) % NOUN.length];
  const form = FORM[(h >>> 10) % FORM.length];
  switch ((h >>> 15) % 4) {
    case 0: return `The ${adj} ${noun} ${form}`;
    case 1: return `The ${form} of the ${adj} ${noun}`;
    case 2: return `The ${adj} ${noun}s`;
    default: return `${form} of the ${noun}`;
  }
}

/** A fresh name each time, from the clock and a counter. */
let counter = 0;
export function randomPartyName(): string {
  return partyNameFrom(`${Date.now()}:${counter++}:${Math.random()}`);
}
