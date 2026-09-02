/**
 * The fated Luck die.
 *
 * When the DM types `roll d20`, the party banks the result as a Luck die.
 * The very next party d20 roll — an attack, saving throw, death save,
 * initiative roll, or trap check — is *fated*: it comes out exactly as the
 * banked result. A high DM roll is a gift; a low one is an ill omen that
 * the party is forced to eat on their next roll.
 *
 * Pure state + observer — no DOM. main.ts narrates spends via onLuckDieSpent.
 */

export interface LuckDie {
  /** The fated d20 result (1–20). */
  value: number;
  /** The DM expression that created it, e.g. "roll d20". */
  source: string;
}

let stored: LuckDie | null = null;
let spendHandler: ((d: LuckDie, roller: string) => void) | null = null;

/** Bank a new fated die (replaces any pending one), or clear with null. */
export function grantLuckDie(d: LuckDie | null): void {
  stored = d ? { ...d } : null;
}

export function getLuckDie(): LuckDie | null {
  return stored ? { ...stored } : null;
}

/**
 * Spend the banked die on the roller's next d20 roll: clears it, reports the
 * spend (so the game can narrate it), and returns the fated die — or null
 * when nothing is banked.
 */
export function consumeLuckDieIfAny(roller: string): LuckDie | null {
  if (!stored) return null;
  const d = stored;
  stored = null;
  spendHandler?.(d, roller);
  return d;
}

/** Register the narration hook for when a fated die is spent. */
export function onLuckDieSpent(fn: (d: LuckDie, roller: string) => void): void {
  spendHandler = fn;
}
