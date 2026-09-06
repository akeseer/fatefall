/**
 * The fight in numbers.
 *
 * The engine narrates; this reads the narration back into a line for the
 * log once the fight is won: rounds, damage dealt and taken, critical hits,
 * the hardest blow and who struck it. Pure, and forgiving of wording it
 * does not know, since a fight's log is prose first.
 */

export interface FightSummary {
  rounds: number;
  dealt: number;
  taken: number;
  crits: number;
  kills: number;
  /** The single largest damage figure and who took it. */
  hardest: { amount: number; victim: string } | null;
  line: string;
}

const DAMAGE = /^(?:\W\s*)?(.+?) takes (\d+) damage/;

/**
 * Summarise a fight from its log. `partyNames` says which "takes N damage"
 * lines were the party's wounds; every other one is damage dealt.
 */
export function summarizeFight(messages: string[], partyNames: string[], rounds: number): FightSummary {
  const party = new Set(partyNames);
  let dealt = 0, taken = 0, crits = 0, kills = 0;
  let hardest: FightSummary['hardest'] = null;
  for (const raw of messages) {
    const msg = raw.trim();
    const m = DAMAGE.exec(msg);
    if (m) {
      const victim = m[1].replace(/^\W+/, '').trim();
      const amount = parseInt(m[2], 10);
      if (party.has(victim)) taken += amount; else dealt += amount;
      if (!hardest || amount > hardest.amount) hardest = { amount, victim };
    }
    if (/CRITICAL|critical hit|CRIT\b/i.test(msg)) crits++;
    if (/ is slain!/.test(msg)) kills++;
  }
  const parts = [`${rounds} round${rounds === 1 ? '' : 's'}`, `${dealt} dealt`, `${taken} taken`];
  if (crits > 0) parts.push(`${crits} critical${crits === 1 ? '' : 's'}`);
  if (kills > 0) parts.push(`${kills} slain`);
  const tail = hardest ? ` Hardest blow: ${hardest.amount} to ${hardest.victim}.` : '';
  return { rounds, dealt, taken, crits, kills, hardest, line: `📊 The fight in numbers: ${parts.join(', ')}.${tail}` };
}
