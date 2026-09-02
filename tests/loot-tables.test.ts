import { describe, it, expect, afterEach, vi } from 'vitest';
import { rollCombatLoot, EMPTY_PURSE, LootSource, LootResult, CoinPurse } from '../src/loot/LootTables';

// rollCombatLoot reaches for Math.random in ~18 places (coin dice, drop gates,
// pool picks). Two fixed values pin the extremes: 0 passes every `< chance`
// gate and rolls minimum dice; 0.99 fails every gate and rolls maximum dice.
const ALWAYS = 0;      // luckiest gates, stingiest dice
const NEVER = 0.99;    // no optional drops at all, fattest dice

function pinRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

function goblin(over: Partial<LootSource> = {}): LootSource {
  return { cr: 1, name: 'Goblin', ...over };
}

/** Roll `n` battles and hand back every result, using the real RNG. */
function sweep(n: number, sources: () => LootSource[], dungeonLevel: number): LootResult[] {
  const out: LootResult[] = [];
  for (let i = 0; i < n; i++) out.push(rollCombatLoot(sources(), dungeonLevel));
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The gp worth of a purse, computed independently of the module under test. */
function expectedGold(coins: CoinPurse): number {
  return Math.round(coins.cp / 100 + coins.sp / 10 + coins.ep / 2 + coins.gp + coins.pp * 10);
}

const DENOMINATIONS: (keyof CoinPurse)[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

describe('rollCombatLoot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty haul for an empty source list instead of throwing', () => {
    const result = rollCombatLoot([], 3);
    expect(result.coins).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    expect(result.goldValue).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.magicItems).toEqual([]);
    expect(result.narration).toEqual([]);
    expect(result.hoard).toBe(false);
  });

  // EMPTY_PURSE is an exported mutable object literal used as a spread template
  // all over the module; one stray `+=` against it would silently inflate every
  // future battle's coins for the rest of the session.
  it('never mutates the shared EMPTY_PURSE template', () => {
    const before = { ...EMPTY_PURSE };
    pinRandom(ALWAYS);
    rollCombatLoot([goblin({ cr: 20, isBoss: true })], 10);
    vi.restoreAllMocks();
    for (let i = 0; i < 200; i++) rollCombatLoot([goblin({ cr: i % 21 })], i % 12);
    expect(EMPTY_PURSE).toEqual(before);
    expect(EMPTY_PURSE).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('reports a gold value that matches the coins actually in the purse', () => {
    for (const result of sweep(300, () => [goblin({ cr: 1 }), goblin({ cr: 9, name: 'Troll' })], 4)) {
      expect(result.goldValue).toBe(expectedGold(result.coins));
    }
  });

  // Fractional or negative coins would show up in the HUD as "12.5 cp" and
  // corrupt the party purse arithmetic downstream.
  it('only ever puts non-negative whole coins in the purse', () => {
    const crs = [0, 1, 4, 5, 10, 11, 16, 17, 24];
    for (let i = 0; i < 300; i++) {
      const cr = crs[i % crs.length];
      const result = rollCombatLoot([goblin({ cr, isBoss: i % 7 === 0 })], i % 11);
      for (const coin of DENOMINATIONS) {
        expect(Number.isInteger(result.coins[coin])).toBe(true);
        expect(result.coins[coin]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives every dropped item a name, an id and a positive gold value', () => {
    const types = ['fiend', 'undead', 'dragon', 'beast', undefined];
    for (let i = 0; i < 300; i++) {
      const result = rollCombatLoot(
        [goblin({ cr: (i % 21), type: types[i % types.length], isBoss: i % 5 === 0 })],
        i % 11,
      );
      for (const item of result.items) {
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.name.trim().length).toBeGreaterThan(0);
        expect(item.description.trim().length).toBeGreaterThan(0);
        expect(typeof item.value).toBe('number');
        expect(Number.isFinite(item.value)).toBe(true);
        expect(item.value!).toBeGreaterThan(0);
      }
    }
  });

  // magicItems is a narration-only view; the party's actual inventory comes
  // from `items`, so a magic item missing there is loot the party never gets.
  it('also puts every magic item into the inventory item list', () => {
    let seenMagic = 0;
    for (let i = 0; i < 250; i++) {
      const result = rollCombatLoot([goblin({ cr: 18, type: 'dragon', isBoss: true })], 8);
      seenMagic += result.magicItems.length;
      for (const mi of result.magicItems) {
        expect(result.items.some(item => item.id === mi.id && item.name === mi.name)).toBe(true);
      }
    }
    expect(seenMagic).toBeGreaterThan(0); // the sweep would be vacuous otherwise
  });

  it('emits only non-empty narration lines', () => {
    for (let i = 0; i < 200; i++) {
      const result = rollCombatLoot([goblin({ cr: i % 20, type: 'undead', isBoss: i % 4 === 0 })], i % 10);
      for (const line of result.narration) {
        expect(typeof line).toBe('string');
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('narrates the hoard first when one is found', () => {
    pinRandom(NEVER); // every optional drop gate fails; only the boss hoard fires
    const result = rollCombatLoot([goblin({ cr: 4, isBoss: true })], 1);
    expect(result.hoard).toBe(true);
    expect(result.narration[0]).toContain('hoard');
  });

  it('gives a boss a hoard even on the worst possible rolls', () => {
    pinRandom(NEVER);
    for (const cr of [1, 6, 12, 20]) {
      expect(rollCombatLoot([goblin({ cr, isBoss: true })], 1).hoard).toBe(true);
    }
  });

  it('yields nothing but the stingiest coin roll when every drop gate fails', () => {
    pinRandom(NEVER);
    const result = rollCombatLoot([goblin({ cr: 1 })], 1);
    // 1d100 reads 100 → the CR 0-4 platinum row → 1d6 pp at max face.
    expect(result.coins).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 6 });
    expect(result.goldValue).toBe(60);
    expect(result.items).toEqual([]);
    expect(result.magicItems).toEqual([]);
    expect(result.hoard).toBe(false);
    expect(result.narration).toEqual(['Coins recovered: 6 pp.']);
  });

  it('drops gems, consumables, magic items and gear when every drop gate passes', () => {
    pinRandom(ALWAYS);
    const result = rollCombatLoot([goblin({ cr: 1 })], 1);
    expect(result.hoard).toBe(true);
    expect(result.magicItems.length).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(3);
    expect(result.narration.length).toBeGreaterThan(1);
  });

  // The narration dedup used to compare id and name rather than identity, so a
  // hoard gem identical to one off a corpse was silently swallowed: the party
  // received two and was told about one.
  it('narrates a hoard gem even when the same gem dropped off a corpse', () => {
    pinRandom(ALWAYS); // CR 12 hoards always carry a gem, and so does the corpse
    const result = rollCombatLoot([goblin({ cr: 12, name: 'Wight' })], 1);
    const azurite = result.items.filter(i => i.id === 'gem_a_chip_of_azurite');
    expect(azurite.length).toBeGreaterThan(1);
    // The corpse line batches its own drops, so count the hoard's own line:
    // it used to be suppressed entirely when the gem matched a corpse drop.
    const hoardLine = result.narration.filter(l => l.startsWith('Also found:') && l.toLowerCase().includes('azurite'));
    expect(hoardLine.length, 'the hoard copy should get its own line').toBe(1);
  });

  it('does not pay out less on average as challenge rating climbs', () => {
    const N = 500;
    const at = (cr: number) => mean(sweep(N, () => [goblin({ cr })], 1).map(r => r.goldValue));
    const low = at(2);
    const mid = at(8);
    const high = at(20);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('does not pay out less on average as the dungeon gets deeper', () => {
    const N = 800;
    const shallow = sweep(N, () => [goblin({ cr: 6 })], 1);
    const deep = sweep(N, () => [goblin({ cr: 6 })], 10);
    // Depth only raises the hoard chance and the tiered-gear odds, so the
    // hoard rate is the sharp signal and the gold mean the blunt one.
    const hoardRate = (rs: LootResult[]) => rs.filter(r => r.hoard).length / rs.length;
    expect(hoardRate(deep)).toBeGreaterThan(hoardRate(shallow));
    expect(mean(deep.map(r => r.goldValue))).toBeGreaterThan(mean(shallow.map(r => r.goldValue)));
  });

  it('pays a boss better than an identical non-boss', () => {
    const N = 300;
    const plain = sweep(N, () => [goblin({ cr: 7 })], 2);
    const boss = sweep(N, () => [goblin({ cr: 7, isBoss: true })], 2);
    expect(boss.every(r => r.hoard)).toBe(true);
    expect(plain.some(r => !r.hoard)).toBe(true);
    expect(mean(boss.map(r => r.goldValue))).toBeGreaterThan(mean(plain.map(r => r.goldValue)));
    expect(mean(boss.map(r => r.items.length))).toBeGreaterThan(mean(plain.map(r => r.items.length)));
  });

  it('adds up the loot of every creature in the battle', () => {
    const N = 200;
    const one = mean(sweep(N, () => [goblin({ cr: 5 })], 1).map(r => r.goldValue));
    const four = mean(sweep(N, () => [
      goblin({ cr: 5 }), goblin({ cr: 5 }), goblin({ cr: 5 }), goblin({ cr: 5 }),
    ], 1).map(r => r.goldValue));
    expect(four).toBeGreaterThan(one);
  });
});
