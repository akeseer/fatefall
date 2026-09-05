import { describe, it, expect } from 'vitest';
import { classifyFx, elementOfSpell } from '../src/ui/BattleFx';

/** The battle window's reading of the combat log, pinned against the engine's own sentences. */
describe('elementOfSpell', () => {
  it('reads the element out of the spell table', () => {
    expect(elementOfSpell('Fireball')).toBe('fire');
    expect(elementOfSpell('Ray of Frost')).toBe('cold');
    expect(elementOfSpell('Lightning Bolt')).toBe('lightning');
    expect(elementOfSpell('Thunderwave')).toBe('thunder');
    expect(elementOfSpell('Chill Touch')).toBe('necrotic');
    expect(elementOfSpell('Sacred Flame')).toBe('radiant');
    expect(elementOfSpell('Magic Missile')).toBe('force');
    expect(elementOfSpell('Vicious Mockery')).toBe('psychic');
    expect(elementOfSpell('Poison Spray')).toBe('poison');
    expect(elementOfSpell('Cure Wounds')).toBe('heal');
    expect(elementOfSpell('Shield')).toBe('arcane');
    expect(elementOfSpell('Not A Spell')).toBeNull();
  });
});

describe('classifyFx', () => {
  it('reads a cast with its target, element and delivery', () => {
    const [ev] = classifyFx('Mira casts Fire Bolt on Goblin!');
    expect(ev).toMatchObject({ kind: 'cast', actor: 'Mira', target: 'Goblin', element: 'fire', projectile: true, aoe: false });
    const [ball] = classifyFx('Mira casts Fireball — the room erupts!');
    expect(ball).toMatchObject({ kind: 'cast', spell: 'Fireball', aoe: true, projectile: false });
    const [up] = classifyFx('Mira upcasts Magic Missile into a 3rd-level slot — 2 levels above base!');
    expect(up).toMatchObject({ kind: 'cast', spell: 'Magic Missile', element: 'force', projectile: true });
  });

  it('adds a buff or a condition when the spell is one', () => {
    const bless = classifyFx('Kael casts Bless! The party gains +1d4 on attack rolls while concentration holds.');
    expect(bless.map(e => e.kind)).toEqual(['cast', 'buff']);
    expect(bless[1].buff).toBe('bless');
    const hold = classifyFx('Kael casts Hold Person on Bandit Captain!');
    expect(hold.map(e => e.kind)).toEqual(['cast', 'condition']);
    expect(hold[1]).toMatchObject({ target: 'Bandit Captain', condition: 'held' });
    const heal = classifyFx('Kael casts Healing Word on Mira — she is badly hurt.');
    expect(heal[0]).toMatchObject({ kind: 'cast', element: 'heal', target: 'Mira' });
  });

  it('knows the class abilities by the engine wording', () => {
    expect(classifyFx('😤 Grom enters a Rage — the fury burns for 3 rounds! (+2 damage)')[0]).toMatchObject({ kind: 'ability', actor: 'Grom', ability: 'rage' });
    expect(classifyFx('🎯 Wren marks Goblin Boss — every hit against it bites for +1d6!')[0]).toMatchObject({ kind: 'ability', actor: 'Wren', target: 'Goblin Boss', ability: 'hunters_mark' });
    expect(classifyFx('🎯 Thorn curses with a crimson rite Ghoul — every hit against it bites for +1d4!')[0]).toMatchObject({ ability: 'blood_mite', target: 'Ghoul' });
    expect(classifyFx('⚡ Kael uses Second Wind!')[0]).toMatchObject({ ability: 'second_wind', actor: 'Kael' });
    expect(classifyFx('⚡ Lyra uses Flurry of Blows!')[0]).toMatchObject({ ability: 'flurry' });
    expect(classifyFx('🗡️ Sneak Attack! Wren finds the gaps for 7 extra damage.')[0]).toMatchObject({ ability: 'sneak_attack', actor: 'Wren' });
    expect(classifyFx('⚡ The infused strike cracks for 4 extra damage!')[0]).toMatchObject({ ability: 'arcane_jolt' });
  });

  it('reads misses, kills and falls', () => {
    expect(classifyFx('Goblin misses Kael.')[0]).toMatchObject({ kind: 'miss', actor: 'Goblin', target: 'Kael' });
    expect(classifyFx('Goblin is slain!')[0]).toMatchObject({ kind: 'kill', target: 'Goblin' });
    expect(classifyFx('Mira succumbs to their wounds and dies!')[0]).toMatchObject({ kind: 'kill', target: 'Mira' });
    expect(classifyFx('Mira has fallen and begins making death saves!')[0]).toMatchObject({ kind: 'down', target: 'Mira' });
  });

  it('reads bosses and specials', () => {
    expect(classifyFx('👑 Ancient Wyrm is a legendary foe — it acts between turns.')[0].kind).toBe('legendary');
    expect(classifyFx('⚡ Ancient Wyrm lashes out — Tail Sweep! Everyone nearby is knocked back.')[0]).toMatchObject({ kind: 'legendary', actor: 'Ancient Wyrm' });
    expect(classifyFx("Wight's life drain chills Kael's soul — 4 extra necrotic damage.")[0]).toMatchObject({ kind: 'special', actor: 'Wight', target: 'Kael', element: 'necrotic' });
    expect(classifyFx('🛡 Ancient Wyrm burns a legendary resistance to shrug it off.')[0]).toMatchObject({ kind: 'buff', buff: 'shield', target: 'Ancient Wyrm' });
  });

  it('reads consumables and conditions, and ignores plain narration', () => {
    expect(classifyFx('Kael drinks Potion of Healing (2d4+2).')[0]).toMatchObject({ kind: 'potion', actor: 'Kael' });
    expect(classifyFx('Mira reads Scroll of Fireball over the foes.')[0]).toMatchObject({ kind: 'scroll', actor: 'Mira' });
    expect(classifyFx('Goblin is poisoned!')[0]).toMatchObject({ kind: 'condition', target: 'Goblin', condition: 'poisoned' });
    expect(classifyFx('Goblin slumps to the stone, unconscious!')[0]).toMatchObject({ condition: 'asleep' });
    expect(classifyFx('The party braces as the doors burst open.')).toEqual([]);
    expect(classifyFx('Kael takes 6 damage (12/18 HP).')).toEqual([]);
  });
});
