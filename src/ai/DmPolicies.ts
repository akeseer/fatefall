/**
 * Standing orders.
 *
 * The DM can tell the party once how to handle the things that come up
 * again and again: pay tolls or refuse them, parley whenever it is offered
 * or never, loot everything. The orders are plain sentences the parser
 * never sees; `parsePolicyOrder` reads them before it runs. Pure.
 */

export interface DmPolicies {
  /** Tolls on the road and in the deep: pay, refuse, or let the party judge. */
  tolls: 'auto' | 'pay' | 'refuse';
  /** Talking bands: always give them the chance, never, or as the party judges. */
  parley: 'auto' | 'always' | 'never';
  /** What to pick up: everything, or leave the junk. */
  loot: 'all' | 'valuables';
}

export const DEFAULT_POLICIES: DmPolicies = { tolls: 'auto', parley: 'auto', loot: 'all' };

export interface PolicyOrder {
  change: Partial<DmPolicies>;
  /** The confirmation line for the log. */
  line: string;
}

const NEVER = /^(?:never|don'?t|do not|no more|stop)\s+/i;
const ALWAYS = /^(?:always|from now on,?\s*(?:always\s+)?)/i;
const RESET = /^(?:forget|clear|reset)\s+(?:the\s+)?(?:standing\s+)?orders?\b/i;

/** Read a standing order out of a typed line, or null if it is not one. */
export function parsePolicyOrder(text: string): PolicyOrder | null {
  const t = text.trim();
  if (RESET.test(t)) return { change: { ...DEFAULT_POLICIES }, line: 'Standing orders cleared. The party decides each thing as it comes.' };
  const never = NEVER.test(t);
  const always = ALWAYS.test(t);
  if (!never && !always) return null;
  const rest = t.replace(never ? NEVER : ALWAYS, '').trim();
  if (/^(?:pay|paying)\s+(?:the\s+)?(?:tolls?|ransoms?|bribes?)\b/i.test(rest)) {
    return never
      ? { change: { tolls: 'refuse' }, line: 'The party will pay no tolls. Whoever asks can take it up with the fighter.' }
      : { change: { tolls: 'pay' }, line: 'The party will pay tolls when it can. Coin is cheaper than blood.' };
  }
  if (/^(?:parley|talk|bargain|negotiate|treat)\b/i.test(rest)) {
    return never
      ? { change: { parley: 'never' }, line: 'No parleys. The party lets steel do the talking.' }
      : { change: { parley: 'always' }, line: 'The party will always hear a band out before a fight.' };
  }
  if (/^(?:loot|pick up|take)\s+(?:everything|all|it all)\b/i.test(rest)) {
    return { change: { loot: never ? 'valuables' : 'all' }, line: never ? 'The party leaves the junk and takes what sells.' : 'The party loots everything that is not nailed down.' };
  }
  if (/^(?:loot|pick up|take)\s+(?:only\s+)?(?:valuables|what sells|the good stuff)\b/i.test(rest)) {
    return { change: { loot: 'valuables' }, line: 'The party takes only what is worth carrying.' };
  }
  return null;
}

/** Short labels for the orders in force, for the Chronicle. */
export function describePolicies(p: DmPolicies): string[] {
  const out: string[] = [];
  if (p.tolls === 'refuse') out.push('never pays tolls');
  if (p.tolls === 'pay') out.push('pays tolls');
  if (p.parley === 'always') out.push('always parleys');
  if (p.parley === 'never') out.push('never parleys');
  if (p.loot === 'valuables') out.push('loots only valuables');
  return out;
}
