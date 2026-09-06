/**
 * The bestiary's second hundred.
 *
 * A hundred more creatures, from cellar vermin to things that end campaigns,
 * spread across every type and every floor. Each carries its own composed
 * sprite (`art`), and the ones with a signature rider (a sting, a gaze, a
 * chill) or a boss's legendary tempo are listed at the bottom so `Rules`
 * can pick them up. `Monster` merges the templates and the theme affinities;
 * nothing here is drawn or rolled.
 */

import type { MonsterTemplate } from './Monster';
import type { MonsterArtSpec, ArtBody, ArtTrait } from './MonsterArt';
import type { MonsterSpecial, BossKit } from '../rules/Rules';

type MType = MonsterTemplate['type'];
type MSize = MonsterTemplate['size'];

/** Experience by challenge rating, the standard table. */
const XP_BY_CR: Record<string, number> = {
  '0.125': 25, '0.25': 50, '0.5': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900,
  '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000,
  '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000,
};

export const EXPANSION_ART: Record<string, MonsterArtSpec> = {};

export function art(body: ArtBody, main: string, dark: string, accent: string, eye: string, traits: ArtTrait[] = [], scale?: number): MonsterArtSpec {
  return { body, palette: { main, dark, accent, eye }, traits, scale };
}

function m(
  id: string, name: string, description: string, cr: number, type: MType, size: MSize,
  hp: number, ac: number, abil: [number, number, number, number, number, number],
  attackBonus: number, damageDice: number, damageDie: number, damageBonus: number,
  spec: MonsterArtSpec, speed = 30,
): MonsterTemplate {
  EXPANSION_ART[id] = spec;
  return {
    id, name, description, hp, ac, speed,
    abilities: { str: abil[0], dex: abil[1], con: abil[2], int: abil[3], wis: abil[4], cha: abil[5] },
    attackBonus, damageDie, damageDice, damageBonus,
    xp: XP_BY_CR[String(cr)] ?? Math.round(cr * 1200), cr, size, type,
  };
}

export const EXPANSION_MONSTERS: MonsterTemplate[] = [
  // ── Vermin and the small dark (CR 1/8 – 1) ──
  m('cellar_leech', 'Cellar Leech', 'A pale, fist-thick leech that drops from damp ceilings onto whatever warm thing passes below.', 0.125, 'beast', 'Small', 6, 10, [4, 12, 12, 1, 8, 2], 3, 1, 4, 1, art('serpent', '#c9b7b0', '#8a6f6a', '#f0d6d0', '#3a1c1c', [], 0.7), 20),
  m('rot_grub_swarm', 'Rot Grub Swarm', 'A heaving carpet of finger-length grubs that burrow toward the heart of anything that lies down among them.', 0.25, 'beast', 'Medium', 12, 8, [3, 12, 10, 1, 6, 1], 3, 2, 4, 0, art('swarm', '#d8c99a', '#8f7d55', '#f7ecc4', '#2a2a2a'), 10),
  m('tomb_moth', 'Tomb Moth', 'A moth the size of a dinner plate whose wing-dust carries the sleep of the grave.', 0.25, 'beast', 'Small', 9, 12, [4, 15, 10, 1, 10, 4], 4, 1, 4, 2, art('flyer', '#9a8f7a', '#5d5443', '#e8dfb8', '#ffd23f', ['glow'], 0.75)),
  m('gutter_kobold', 'Gutter Kobold', 'A kobold gone feral in the city drains, armed with a sharpened spoon and no sense of proportion.', 0.125, 'humanoid', 'Small', 5, 12, [7, 15, 9, 8, 7, 8], 4, 1, 4, 2, art('biped', '#b8542e', '#6f2e17', '#e8b45a', '#ffd23f', ['weapon'], 0.75)),
  m('bog_imp', 'Bog Imp', 'A soot-black imp that lives in marsh gas and lights it when it laughs.', 0.5, 'fiend', 'Small', 10, 13, [6, 17, 13, 11, 12, 14], 5, 1, 4, 3, art('biped', '#3c3a3f', '#1e1d21', '#8dff5a', '#ff5a3c', ['horns', 'tail', 'wings', 'flames'], 0.75)),
  m('mud_sprite', 'Mud Sprite', 'A fey the size of a hand, made of riverbank silt, that hates boots with a passion.', 0.25, 'fey', 'Small', 8, 13, [5, 16, 11, 10, 12, 13], 4, 1, 4, 2, art('biped', '#7a5e3e', '#4a3722', '#c9a56a', '#ffffff', ['wings'], 0.65)),
  m('hollow_hound', 'Hollow Hound', 'The skin of a hunting dog with nothing inside it but a cold draft and a bark.', 0.5, 'undead', 'Medium', 13, 12, [13, 14, 12, 3, 10, 5], 4, 1, 6, 2, art('quadruped', '#6f7378', '#3c3f43', '#9fe8ff', '#9fe8ff', ['fangs', 'glow'])),
  m('lantern_wight', 'Lantern Wight', 'A drowned lamplighter who still makes his rounds, and his lamp still draws the lost to him.', 1, 'undead', 'Medium', 22, 13, [13, 14, 14, 8, 11, 10], 4, 1, 8, 2, art('biped', '#4e6b62', '#2b3d37', '#ffe08a', '#9fe8ff', ['cloak', 'staff', 'glow'])),
  m('stair_crawler', 'Stair Crawler', 'A many-legged thing that lives under stairs and takes the ankle of whoever forgets to look down.', 0.5, 'monstrosity', 'Small', 11, 13, [8, 15, 12, 2, 10, 3], 4, 1, 6, 2, art('spider', '#5a4a3a', '#2f261d', '#c9a56a', '#ffd23f', [], 0.8), 40),
  m('brine_zombie', 'Brine Zombie', 'A sailor a long time in the water, still walking, still salt-crusted, still tied to his ship by a rope that is not there.', 0.5, 'undead', 'Medium', 24, 9, [14, 6, 16, 3, 6, 5], 4, 1, 6, 2, art('biped', '#5f7a6f', '#34463f', '#c4d7cc', '#9fe8ff', ['chains'])),
  m('hedge_gnoll', 'Hedge Gnoll', 'A young gnoll driven out of the pack, hunting the roads alone and desperate.', 0.5, 'humanoid', 'Medium', 15, 13, [14, 13, 12, 6, 10, 7], 4, 1, 8, 2, art('biped', '#9a7a4a', '#5b4629', '#e0c08a', '#ffd23f', ['weapon', 'fangs'])),
  m('goblin_ratcatcher', 'Goblin Ratcatcher', 'A goblin with a sack of rats and a plan involving them.', 0.25, 'humanoid', 'Small', 8, 13, [8, 15, 10, 10, 9, 8], 4, 1, 6, 2, art('biped', '#5c7d3c', '#354a22', '#c9b76a', '#ffd23f', ['hood'], 0.75)),
  m('drain_ooze', 'Drain Ooze', 'A grey ooze that has learned the drains, and rises out of them under whichever grate you are standing on.', 0.5, 'ooze', 'Medium', 22, 8, [12, 6, 16, 1, 6, 2], 3, 1, 6, 1, art('blob', '#6c7370', '#3e4340', '#a9b3ae', '#e8ffb0'), 10),
  m('chapel_gargoyle_chick', 'Gargoyle Chick', 'A gargoyle the size of a cat, all beak and grudge, not yet old enough to hold still.', 1, 'elemental', 'Small', 18, 14, [12, 13, 14, 5, 10, 6], 4, 1, 6, 2, art('flyer', '#6b6b70', '#3a3a3f', '#a8a8b0', '#ffd23f', ['horns', 'claws'], 0.75)),
  m('thornback_hare', 'Thornback Hare', 'A hare grown a hedge of spines along its spine, and a temper to match.', 0.25, 'beast', 'Small', 9, 13, [8, 16, 12, 2, 12, 5], 4, 1, 4, 2, art('quadruped', '#8a7452', '#54452f', '#5c7d3c', '#2a2a2a', ['spikes'], 0.7), 50),
  m('ash_wisp', 'Ash Wisp', 'A cinder that has not gone out in a hundred years, drifting toward anything it can set alight.', 1, 'elemental', 'Small', 15, 14, [1, 17, 10, 6, 12, 8], 5, 1, 6, 3, art('orb', '#ff9a3c', '#b8501e', '#ffe08a', '#ffffff', ['flames'], 0.7), 40),
  m('barrow_rat', 'Barrow Rat', 'A rat fattened on grave goods, its teeth yellow with old gold.', 0.125, 'beast', 'Small', 5, 11, [6, 14, 10, 2, 9, 3], 3, 1, 4, 1, art('quadruped', '#5e5045', '#372d26', '#c9a56a', '#ff5a3c', ['fangs', 'tail'], 0.65)),
  m('pit_kobold_slinger', 'Kobold Slinger', 'A kobold with a sling, a bag of lead, and a firing position it will die to keep.', 0.25, 'humanoid', 'Small', 8, 12, [7, 15, 9, 8, 8, 8], 4, 1, 4, 2, art('biped', '#b8542e', '#6f2e17', '#e8b45a', '#ffd23f', ['bow'], 0.75)),
  m('mire_frog_giant', 'Mire Bullfrog', 'A frog you could saddle, with a tongue like a wet rope and no fear of anything smaller than a horse.', 0.5, 'beast', 'Medium', 18, 11, [12, 13, 11, 2, 10, 3], 3, 1, 6, 1, art('quadruped', '#5c7d3c', '#354a22', '#c9d97a', '#ffd23f', [])),
  m('candle_ghost', 'Candle Ghost', 'A faint shape that only appears where a candle burns, and blows it out when it is close enough to touch.', 1, 'undead', 'Medium', 20, 12, [1, 14, 11, 10, 12, 12], 4, 1, 8, 2, art('wraith', '#cfd3d6', '#8f959a', '#ffe08a', '#9fe8ff', ['glow'])),
  m('nettle_blight', 'Nettle Blight', 'A blight grown through a nettle bed, every touch a rash of fire.', 0.5, 'plant', 'Small', 12, 12, [10, 12, 12, 4, 8, 3], 4, 1, 6, 2, art('tree', '#4f7a3a', '#2c4620', '#b8e06a', '#ffd23f', ['spikes'], 0.75), 20),
  m('sewer_stirge', 'Sewer Stirge', 'A stirge grown fat and slow on rats, which has decided people are slower rats.', 0.125, 'beast', 'Small', 4, 13, [4, 15, 10, 2, 8, 6], 4, 1, 4, 1, art('flyer', '#6d4e3e', '#3d2b22', '#c9a56a', '#ff5a3c', ['fangs'], 0.6), 40),
  m('cracked_animated_statue', 'Cracked Statue', 'A garden statue that has been walking for years without anyone noticing, since it only moves when unobserved.', 1, 'construct', 'Medium', 24, 15, [15, 8, 16, 1, 6, 1], 4, 1, 8, 3, art('biped', '#9d9d9d', '#5f5f5f', '#c8c8c8', '#ffffff', []), 20),
  m('grave_moth_swarm', 'Grave Moth Swarm', 'Thousands of pale moths that rise from an opened tomb and settle, all at once, on the face.', 0.5, 'beast', 'Medium', 16, 12, [3, 14, 10, 1, 8, 1], 4, 2, 4, 0, art('swarm', '#d6d0c4', '#8a8478', '#f7f2e8', '#2a2a2a'), 30),
  m('tallow_man', 'Tallow Man', 'A figure of rendered fat and wick, lit at the crown, that stumbles toward the warmth of the living.', 1, 'construct', 'Medium', 26, 10, [13, 9, 14, 3, 6, 4], 4, 1, 8, 2, art('biped', '#e8dcb8', '#a99b73', '#ff9a3c', '#ff5a3c', ['flames']), 20),

  // ── Bands, packs and the middle floors (CR 2 – 4) ──
  m('gnoll_flesh_gnawer', 'Gnoll Flesh Gnawer', 'A gnoll that fights with two blades and a mouth, and considers all three weapons.', 2, 'humanoid', 'Medium', 30, 14, [14, 16, 12, 8, 10, 8], 5, 2, 6, 2, art('biped', '#9a7a4a', '#5b4629', '#e0c08a', '#ffd23f', ['weapon', 'fangs'])),
  m('orc_grave_singer', 'Orc Grave Singer', 'An orc who sings the war-dead back to their feet, briefly, and sends them forward first.', 3, 'humanoid', 'Medium', 42, 13, [16, 12, 15, 9, 13, 12], 5, 1, 12, 3, art('biped', '#5e7a52', '#354a2e', '#c9d97a', '#ffffff', ['staff', 'crown'])),
  m('hobgoblin_ironsmith', 'Hobgoblin Ironsmith', 'A hobgoblin in the armour it made itself, which is better than yours.', 3, 'humanoid', 'Medium', 45, 18, [16, 12, 16, 12, 10, 10], 5, 1, 10, 3, art('biped', '#b0663c', '#6a3a1e', '#a8a8b0', '#ffffff', ['weapon', 'shield'])),
  m('bandit_arcanist', 'Bandit Arcanist', 'A failed apprentice who took three spells and a grudge to the roads.', 2, 'humanoid', 'Medium', 27, 12, [9, 14, 12, 15, 11, 12], 5, 2, 6, 2, art('biped', '#4a4a6a', '#2a2a3e', '#8dd8ff', '#ffffff', ['staff', 'hood'])),
  m('barrow_hound', 'Barrow Hound', 'A great dog buried with its master, and loyal to the grave, and past it.', 2, 'undead', 'Medium', 32, 13, [16, 14, 15, 3, 12, 6], 5, 1, 8, 3, art('quadruped', '#6f7378', '#3c3f43', '#9fe8ff', '#9fe8ff', ['fangs', 'glow', 'tail']), 40),
  m('rust_wyrmling', 'Rust Wyrmling', 'A small dragon that eats iron and breathes a red mist that eats it faster.', 3, 'dragon', 'Medium', 44, 15, [15, 12, 15, 10, 11, 12], 5, 1, 10, 3, art('flyer', '#b0562e', '#6a301a', '#e8b45a', '#ffd23f', ['horns', 'tail', 'wings'])),
  m('lamplighter_specter', 'Lamplighter Specter', 'A specter that snuffs every light in a room before it comes for the ones who lit them.', 2, 'undead', 'Medium', 26, 12, [1, 15, 11, 10, 10, 11], 5, 1, 8, 3, art('wraith', '#8fa0b0', '#4f5a66', '#ffe08a', '#9fe8ff', ['glow', 'staff']), 50),
  m('vine_strangler', 'Vine Strangler', 'A vine that has learned what a throat is.', 2, 'plant', 'Medium', 34, 12, [15, 10, 14, 2, 10, 3], 5, 1, 8, 3, art('tree', '#3c6b2e', '#223d19', '#8dff5a', '#ffd23f', ['tentacles']), 10),
  m('quarry_troll_whelp', 'Quarry Troll', 'A young troll that lives in a flooded quarry and comes out grey with stone dust and hungry.', 4, 'giant', 'Large', 66, 14, [18, 12, 18, 6, 9, 7], 6, 1, 10, 4, art('brute', '#7a8a7a', '#45524a', '#b8c8b8', '#ffd23f', ['claws'], 1.1)),
  m('ettercap_weaver', 'Ettercap Weaver', 'An ettercap that lays its webs across whole corridors and waits in the ceiling above them.', 2, 'monstrosity', 'Medium', 36, 13, [14, 15, 13, 7, 12, 8], 5, 1, 8, 2, art('spider', '#4a3a5a', '#2a2036', '#c9c9e0', '#ffd23f', ['fangs'])),
  m('salt_mummy', 'Salt Mummy', 'A body cured in a salt mine and woken there, so dry the touch of it draws the water from the living.', 3, 'undead', 'Medium', 52, 12, [16, 8, 15, 6, 10, 12], 5, 1, 10, 3, art('biped', '#d8d0bc', '#8f8874', '#f5efe0', '#ff5a3c', ['chains']), 20),
  m('cinder_hound', 'Cinder Hound', 'A hound of the fire plane, small as such things go, that leaves burning pawprints.', 3, 'fiend', 'Medium', 45, 14, [16, 13, 15, 6, 12, 6], 5, 1, 8, 3, art('quadruped', '#c4462a', '#6e2413', '#ffe08a', '#ffe08a', ['flames', 'fangs', 'tail']), 50),
  m('gloom_stalker_cat', 'Gloom Cat', 'A great cat the colour of the dark between torches, which is where it stays.', 3, 'monstrosity', 'Large', 48, 14, [16, 17, 14, 5, 13, 8], 6, 1, 8, 3, art('quadruped', '#2c2c36', '#151519', '#5a5a70', '#9fe8ff', ['fangs', 'claws', 'tail'], 1.1), 50),
  m('duergar_stonewright', 'Duergar Stonewright', 'A duergar who shapes stone with a word, and pulls walls down with the same one.', 3, 'humanoid', 'Medium', 40, 16, [15, 11, 16, 14, 12, 9], 5, 1, 8, 3, art('biped', '#6b6570', '#3e3a42', '#c9a56a', '#ffffff', ['staff', 'shield'], 0.9), 25),
  m('drowned_knight', 'Drowned Knight', 'A knight in rusted plate who walked into the lake in full armour and, some years later, walked out.', 4, 'undead', 'Medium', 60, 17, [18, 9, 16, 6, 10, 8], 6, 1, 10, 4, art('biped', '#5f7a6f', '#34463f', '#a8a8b0', '#9fe8ff', ['weapon', 'shield'])),
  m('screech_harpy', 'Screech Harpy', 'A harpy whose song went bad; it stuns instead of lures, and she eats what stands still.', 2, 'monstrosity', 'Medium', 34, 12, [12, 14, 12, 7, 10, 13], 4, 1, 8, 2, art('flyer', '#8a6a4a', '#4f3c29', '#e0c08a', '#ffd23f', ['claws', 'wings']), 40),
  m('kobold_scale_sorcerer', 'Kobold Scale Sorcerer', 'A kobold with dragon in its blood, and the sense to stand behind its friends when it proves it.', 2, 'humanoid', 'Small', 24, 13, [7, 15, 12, 14, 11, 15], 5, 2, 6, 3, art('biped', '#b8542e', '#6f2e17', '#ffd23f', '#ffd23f', ['staff', 'horns'], 0.75)),
  m('ghoul_gravedigger', 'Ghoul Gravedigger', 'A ghoul that keeps the graveyard tidy, since a tidy graveyard is a well-stocked one.', 2, 'undead', 'Medium', 33, 13, [14, 15, 12, 8, 10, 7], 5, 1, 8, 3, art('biped', '#7a8a6a', '#45523c', '#c9d9b8', '#ff5a3c', ['weapon', 'claws'])),
  m('web_choker', 'Web Choker', 'A choker that has moved into a spider\'s web and wears it as a cloak.', 2, 'aberration', 'Small', 26, 15, [16, 15, 13, 4, 12, 7], 5, 1, 6, 3, art('biped', '#7a6a8a', '#463a52', '#d8d8f0', '#b8ff5a', ['tentacles', 'cloak'], 0.8)),
  m('marsh_troll_bride', 'Marsh Hag Bride', 'A hag\'s daughter, not yet a hag, and trying very hard.', 4, 'fey', 'Medium', 58, 14, [16, 13, 16, 13, 14, 14], 6, 1, 10, 3, art('biped', '#5c7d5c', '#334833', '#c9d97a', '#ffd23f', ['claws', 'hood'])),
  m('blackpowder_goblin', 'Blackpowder Goblin', 'A goblin who found a cask of something and has not stopped setting fire to things since.', 2, 'humanoid', 'Small', 22, 13, [8, 16, 12, 12, 9, 10], 5, 2, 6, 2, art('biped', '#5c7d3c', '#354a22', '#ff9a3c', '#ffd23f', ['flames'], 0.75)),
  m('mirror_mimic', 'Mirror Mimic', 'A mimic that has learned to be a mirror, and to hold the shape of whoever looks in it long enough.', 3, 'monstrosity', 'Medium', 50, 12, [17, 12, 15, 6, 13, 8], 5, 1, 8, 3, art('blob', '#9fb0b8', '#5a6a72', '#e8f4ff', '#ffd23f', ['fangs']), 15),
  m('bone_naga_hatchling', 'Bone Naga Hatchling', 'A naga skeleton the length of a spear, animated before it was fully grown, and angry about it.', 3, 'undead', 'Medium', 40, 13, [14, 15, 12, 12, 13, 13], 5, 1, 8, 3, art('serpent', '#d8d0bc', '#8f8874', '#9fe8ff', '#9fe8ff', ['crown'])),
  m('storm_crow_swarm', 'Storm Crow Swarm', 'Crows that ride a thunderhead and land on a battlefield before the fighting starts.', 2, 'beast', 'Medium', 28, 13, [6, 16, 12, 3, 12, 6], 5, 2, 4, 1, art('swarm', '#2a2a36', '#111118', '#8dd8ff', '#ffd23f'), 50),
  m('iron_cobra_tomb', 'Tomb Cobra', 'A brass serpent left coiled on a sarcophagus with one purpose, which it has kept for a thousand years.', 4, 'construct', 'Medium', 55, 16, [14, 16, 15, 3, 12, 1], 6, 1, 8, 3, art('serpent', '#b8963c', '#6f5a22', '#ffe08a', '#ff5a3c', ['glow'])),
  m('fen_wight_lord', 'Fen Wight', 'A wight risen from a peat bog with the bog still on it, and the bog\'s patience.', 4, 'undead', 'Medium', 62, 14, [17, 13, 17, 10, 13, 14], 6, 1, 10, 4, art('biped', '#4a5a3a', '#2a3420', '#8dff5a', '#9fe8ff', ['cloak', 'weapon'])),
  m('pilgrim_gargoyle', 'Pilgrim Gargoyle', 'A gargoyle that left its cathedral and now walks the roads, kneeling at shrines and killing at crossroads.', 3, 'elemental', 'Medium', 50, 15, [15, 11, 16, 6, 11, 7], 5, 1, 8, 3, art('biped', '#6b6b70', '#3a3a3f', '#a8a8b0', '#ffd23f', ['wings', 'horns', 'claws'])),
  m('hill_giant_runt', 'Hill Giant Runt', 'A hill giant too small for the clan, which is still eleven feet of resentment.', 4, 'giant', 'Large', 70, 12, [19, 8, 17, 5, 9, 6], 6, 2, 6, 4, art('brute', '#a8865a', '#6a5236', '#e0c08a', '#ffffff', ['weapon'], 1.12), 40),
  m('sea_hag_daughter', 'Sea Hag Daughter', 'Something born to a sea hag on a bad night, all teeth and salt and the mother\'s eyes.', 3, 'fey', 'Medium', 44, 13, [15, 13, 15, 12, 12, 12], 5, 1, 8, 3, art('biped', '#4a7a7a', '#2a4646', '#8dd8ff', '#ffd23f', ['fins', 'claws'])),
  m('clay_sentinel', 'Clay Sentinel', 'A clay figure set to guard a door, which has forgotten the door and remembers only guarding.', 4, 'construct', 'Large', 68, 15, [18, 8, 18, 3, 8, 1], 6, 2, 8, 4, art('brute', '#a86a4a', '#6a4028', '#e0b08a', '#ffffff', [], 1.1), 20),
  m('dust_djinn_lesser', 'Dust Djinni', 'A minor djinni of the dry wind, made of the same grit it throws in your eyes.', 4, 'elemental', 'Large', 60, 14, [14, 18, 15, 12, 13, 14], 6, 2, 6, 3, art('wraith', '#c9b58a', '#8a7a55', '#ffe08a', '#ffffff', ['glow'], 1.1), 60),

  // ── Things that hold a floor (CR 5 – 9) ──
  m('gnoll_bone_shaman', 'Gnoll Bone Shaman', 'A gnoll that wears the bones of what it ate and calls their strength back when it needs it.', 5, 'humanoid', 'Medium', 75, 15, [15, 14, 15, 11, 15, 12], 7, 2, 8, 3, art('biped', '#9a7a4a', '#5b4629', '#f5efe0', '#ff5a3c', ['staff', 'fangs', 'crown'])),
  m('crypt_lion', 'Crypt Lion', 'A lion carved in stone at a king\'s tomb, which the king\'s curse has given something like life.', 5, 'construct', 'Large', 85, 16, [19, 12, 17, 4, 12, 8], 7, 2, 8, 4, art('quadruped', '#9d9d9d', '#5f5f5f', '#c8c8c8', '#ffd23f', ['mane', 'claws', 'tail'], 1.12)),
  m('plague_priest', 'Plague Priest', 'A priest of the rot god, whose blessings are contagious.', 5, 'humanoid', 'Medium', 68, 14, [12, 13, 15, 14, 17, 15], 7, 2, 8, 3, art('biped', '#6a6a3a', '#3e3e20', '#b8e06a', '#b8ff5a', ['staff', 'hood', 'cloak'])),
  m('ogre_gaoler', 'Ogre Gaoler', 'An ogre with a ring of keys and a cage on its back, still occupied.', 5, 'giant', 'Large', 90, 13, [20, 9, 18, 6, 8, 7], 7, 2, 8, 5, art('brute', '#a8865a', '#6a5236', '#a8a8b0', '#ffffff', ['chains', 'weapon'], 1.12)),
  m('wyvern_matron', 'Wyvern Matron', 'A wyvern with a clutch to feed, which makes her twice as fast and half as careful.', 6, 'dragon', 'Large', 110, 14, [19, 12, 18, 6, 12, 7], 8, 2, 8, 4, art('flyer', '#6a4a8a', '#3e2a52', '#c9a56a', '#ffd23f', ['wings', 'tail', 'horns', 'spikes'], 1.15), 80),
  m('abyssal_chanter', 'Abyssal Chanter', 'A fiend whose only weapon is a voice, and whose voice is enough.', 6, 'fiend', 'Medium', 95, 15, [14, 16, 16, 15, 14, 19], 8, 2, 8, 4, art('biped', '#5a2a4a', '#331a2c', '#ff5a3c', '#ff5a3c', ['horns', 'cloak', 'glow'])),
  m('hollow_treant', 'Hollow Treant', 'A treant that died standing and was hollowed by rot, and in whose hollow something else now sits and works the branches.', 7, 'plant', 'Large', 120, 15, [22, 8, 20, 10, 14, 10], 9, 3, 6, 6, art('tree', '#5a4a3a', '#2f261d', '#8dff5a', '#b8ff5a', ['glow'], 1.15), 20),
  m('gith_tomb_raider', 'Githyanki Tomb Raider', 'A githyanki who came for a lich\'s phylactery and stayed for everything else.', 6, 'humanoid', 'Medium', 88, 17, [16, 16, 15, 13, 12, 14], 8, 2, 8, 4, art('biped', '#c9b56a', '#8a7a3c', '#a8a8b0', '#ffffff', ['weapon', 'shield'])),
  m('winter_wolf_lord', 'Winter Wolf Lord', 'The largest winter wolf of a pack that has eaten every other pack on the mountain.', 7, 'monstrosity', 'Large', 115, 14, [20, 14, 18, 8, 13, 10], 9, 2, 8, 5, art('quadruped', '#dfe8f0', '#8fa0b0', '#cfefff', '#8dd8ff', ['frost', 'fangs', 'tail', 'crown'], 1.15), 50),
  m('animated_siege_engine', 'Animated Ballista', 'A siege ballista that was taught to load itself and has since taught itself to aim.', 7, 'construct', 'Large', 130, 16, [20, 10, 20, 1, 8, 1], 9, 3, 10, 5, art('brute', '#6a4a2a', '#3e2a16', '#a8a8b0', '#ff5a3c', ['bow'], 1.15), 20),
  m('lich_apprentice', 'Lich Apprentice', 'A necromancer halfway through becoming a lich, who has all the hunger and none of the patience.', 8, 'undead', 'Medium', 105, 15, [11, 16, 16, 19, 14, 15], 9, 3, 8, 4, art('biped', '#4a4a6a', '#2a2a3e', '#8dff5a', '#8dff5a', ['staff', 'hood', 'glow'])),
  m('basilisk_king', 'Basilisk King', 'A basilisk grown old enough that its gaze turns not only flesh but the courage in it.', 8, 'monstrosity', 'Large', 140, 16, [20, 9, 18, 3, 10, 8], 9, 2, 10, 5, art('quadruped', '#5c7d3c', '#354a22', '#c9d97a', '#ffd23f', ['spikes', 'crown', 'tail'], 1.15), 20),
  m('flame_naga', 'Flame Naga', 'A naga that swam a river of fire once, and never quite came out of it.', 8, 'monstrosity', 'Large', 125, 16, [16, 18, 17, 16, 15, 17], 9, 2, 8, 4, art('serpent', '#c4462a', '#6e2413', '#ffe08a', '#ffe08a', ['flames', 'crown', 'fangs'], 1.15), 40),
  m('cloud_giant_exile', 'Cloud Giant Exile', 'A cloud giant cast down for a crime the clouds do not name, living small in a cave and hating it.', 9, 'giant', 'Large', 160, 15, [24, 10, 20, 12, 14, 14], 10, 3, 8, 7, art('brute', '#c9d0e0', '#7a8496', '#e8f4ff', '#8dd8ff', ['weapon', 'cloak'], 1.15), 40),
  m('shade_assassin', 'Shade Assassin', 'A killer who traded their shadow for the ability to be one.', 8, 'undead', 'Medium', 98, 17, [12, 20, 14, 14, 13, 12], 10, 3, 6, 5, art('wraith', '#2c2c36', '#111118', '#5a5a70', '#9fe8ff', ['weapon', 'hood'])),
  m('bronze_bull_construct', 'Bronze Bull', 'A bull of bronze with a furnace for a belly, built to burn a city\'s enemies and never told the war ended.', 9, 'construct', 'Large', 165, 18, [24, 11, 22, 1, 10, 1], 10, 2, 10, 7, art('quadruped', '#b8963c', '#6f5a22', '#ff9a3c', '#ff5a3c', ['horns', 'flames', 'tail'], 1.15), 40),
  m('drow_spider_priestess', 'Drow Spider Priestess', 'A priestess of the spider queen, attended by the queen\'s children and the queen\'s attention.', 8, 'humanoid', 'Medium', 100, 16, [12, 18, 15, 15, 16, 18], 9, 2, 8, 4, art('biped', '#4a3a5a', '#2a2036', '#d8d8f0', '#ff5a3c', ['staff', 'crown', 'cloak'])),
  m('bog_body_colossus', 'Bog Colossus', 'A hundred bog bodies knotted into one, walking with a hundred sets of legs and a single purpose.', 9, 'undead', 'Large', 175, 13, [23, 8, 22, 5, 10, 8], 10, 3, 8, 6, art('brute', '#4a5a3a', '#2a3420', '#8a9a6a', '#9fe8ff', ['chains'], 1.15), 20),
  m('gorgon_bull_elder', 'Elder Gorgon', 'An iron bull whose breath turns a whole corridor to statues, and who likes the company.', 9, 'monstrosity', 'Large', 150, 19, [22, 11, 20, 2, 12, 7], 10, 2, 12, 6, art('quadruped', '#6b6b70', '#3a3a3f', '#a8a8b0', '#ff5a3c', ['horns', 'tail', 'spikes'], 1.15), 40),
  m('phase_panther', 'Phase Panther', 'A panther that is only ever half in the room, and always the half with the teeth.', 6, 'monstrosity', 'Large', 92, 15, [18, 18, 16, 6, 14, 8], 8, 2, 6, 4, art('quadruped', '#3a2a5a', '#211833', '#b8a8ff', '#b8ff5a', ['fangs', 'claws', 'tail', 'glow'], 1.1), 60),
  m('reliquary_golem', 'Reliquary Golem', 'A golem built around a saint\'s bones, holy enough to hurt the unholy and strong enough to hurt everyone else.', 7, 'construct', 'Large', 128, 17, [21, 9, 20, 3, 12, 1], 9, 2, 10, 5, art('brute', '#c9b56a', '#8a7a3c', '#ffe08a', '#ffffff', ['halo', 'shield'], 1.12), 20),
  m('harrow_hag', 'Harrow Hag', 'A hag who lives in a ploughed field and reaps what the farmers do not.', 7, 'fey', 'Medium', 110, 16, [18, 14, 18, 15, 16, 16], 9, 2, 10, 4, art('biped', '#5c7d5c', '#334833', '#c9d97a', '#ffd23f', ['claws', 'weapon', 'hood'])),
  m('storm_roc_fledgling', 'Roc Fledgling', 'A roc chick the size of a house, hungry and unsteady, which makes it more dangerous rather than less.', 8, 'monstrosity', 'Large', 145, 14, [22, 12, 18, 3, 12, 8], 10, 3, 8, 6, art('flyer', '#8a6a4a', '#4f3c29', '#e0c08a', '#ffd23f', ['wings', 'claws'], 1.15), 80),
  m('night_hag_coven_mother', 'Coven Mother', 'The eldest of a coven of night hags, who does not sleep and does not let others.', 9, 'fiend', 'Medium', 140, 17, [18, 16, 18, 17, 16, 18], 10, 2, 8, 5, art('biped', '#4a2a5a', '#2a1833', '#b8a8ff', '#ff5a3c', ['claws', 'crown', 'cloak', 'glow'])),

  // ── Powers of the deep floors (CR 10 – 15) ──
  m('vampire_duelist', 'Vampire Duelist', 'A vampire who was a fencing master in life and has had three centuries to practise since.', 10, 'undead', 'Medium', 150, 18, [18, 20, 18, 15, 15, 18], 11, 3, 8, 5, art('biped', '#3a2a3a', '#1e151e', '#ff5a3c', '#ff5a3c', ['weapon', 'cloak', 'fangs'])),
  m('frost_lich_servitor', 'Rime Servitor', 'An ice-bound knight that a frost lich raised to keep its halls, and keeps them very cold.', 10, 'undead', 'Large', 165, 18, [22, 12, 20, 10, 13, 12], 11, 3, 8, 6, art('brute', '#cfefff', '#8fa0b0', '#e8f4ff', '#8dd8ff', ['frost', 'weapon', 'shield'], 1.12), 30),
  m('chain_devil_warden', 'Chain Warden', 'A chain devil that runs a prison of the damned and treats the living as new arrivals.', 11, 'fiend', 'Medium', 170, 17, [20, 16, 20, 12, 12, 14], 11, 3, 8, 6, art('biped', '#5a4a4a', '#332a2a', '#a8a8b0', '#ff5a3c', ['chains', 'horns', 'glow'])),
  m('mind_flayer_lichen_lord', 'Lichen Lord', 'A mind flayer that grew a garden in its own skull, and now thinks with the garden.', 11, 'aberration', 'Medium', 155, 16, [12, 14, 18, 20, 18, 17], 11, 3, 8, 4, art('biped', '#6a5a8a', '#3e3452', '#8dff5a', '#b8ff5a', ['tentacles', 'cloak', 'glow'])),
  m('crystal_basilisk', 'Crystal Basilisk', 'A basilisk of the crystal caves, which turns what it looks at to glass and then walks through it.', 12, 'monstrosity', 'Large', 190, 18, [22, 12, 21, 4, 13, 9], 12, 3, 10, 6, art('quadruped', '#9fb0d8', '#5a6a8a', '#e8f4ff', '#8dd8ff', ['spikes', 'crown', 'tail', 'glow'], 1.15), 20),
  m('ancient_treant_warden', 'Warden of the Old Wood', 'A treant older than the forest around it, which it planted, and which it will defend.', 12, 'plant', 'Large', 220, 17, [25, 8, 22, 14, 18, 14], 12, 3, 8, 7, art('tree', '#3c6b2e', '#223d19', '#c9d97a', '#ffd23f', ['crown', 'antlers'], 1.15), 30),
  m('pit_fiend_quartermaster', 'Infernal Quartermaster', 'A devil in charge of the ninth hell\'s stores, who counts souls the way others count sacks of grain.', 13, 'fiend', 'Large', 230, 19, [24, 14, 22, 18, 16, 20], 13, 3, 10, 7, art('brute', '#7a2a2a', '#4a1818', '#ff9a3c', '#ff5a3c', ['horns', 'wings', 'weapon', 'flames'], 1.15), 30),
  m('kraken_spawn_elder', 'Elder Kraken Spawn', 'A kraken\'s child that has eaten enough sailors to be a kraken in all but name.', 13, 'monstrosity', 'Large', 240, 16, [25, 12, 23, 10, 14, 10], 13, 3, 10, 7, art('blob', '#2a4a6a', '#152a3e', '#8dd8ff', '#b8ff5a', ['tentacles', 'fins', 'glow'], 1.15), 20),
  m('sphinx_of_the_locks', 'Sphinx of the Locks', 'A sphinx who guards every door on its floor and asks a price at each: an answer, or a hand.', 12, 'monstrosity', 'Large', 200, 18, [22, 12, 20, 18, 20, 18], 12, 3, 8, 6, art('quadruped', '#c9b56a', '#8a7a3c', '#ffe08a', '#ffffff', ['wings', 'crown', 'mane', 'tail'], 1.15), 40),
  m('death_knight_seneschal', 'Death Knight Seneschal', 'The steward of a dead king\'s hall, who keeps the household running with a household of the dead.', 14, 'undead', 'Medium', 240, 20, [22, 12, 22, 14, 16, 18], 14, 3, 10, 7, art('biped', '#3a3a4a', '#1e1e2a', '#9fe8ff', '#9fe8ff', ['weapon', 'shield', 'crown', 'glow'])),
  m('storm_giant_widow', 'Storm Giant Widow', 'A storm giant in mourning, which on a storm giant looks like weather.', 14, 'giant', 'Large', 260, 17, [28, 14, 22, 16, 18, 18], 14, 3, 10, 9, art('brute', '#4a5a7a', '#2a3448', '#8dd8ff', '#ffffff', ['weapon', 'cloak', 'glow'], 1.15), 50),
  m('beholder_dreamer', 'Dreaming Beholder', 'A beholder asleep for a century, whose dreams have eyes of their own and wander the halls.', 13, 'aberration', 'Large', 210, 18, [12, 16, 20, 19, 17, 18], 13, 3, 8, 5, art('orb', '#8a5a8a', '#4e334e', '#b8a8ff', '#b8ff5a', ['glow'], 1.15), 20),
  m('adamant_golem_titan', 'Adamant Titan', 'A golem of adamantine built by giants for a war they lost, which does not know it.', 15, 'construct', 'Large', 300, 21, [28, 8, 24, 3, 11, 1], 15, 4, 10, 9, art('brute', '#3a3a4a', '#1e1e2a', '#8dd8ff', '#ff5a3c', ['shield'], 1.15), 30),
  m('ancient_hydra_of_the_well', 'Hydra of the Well', 'A hydra that has lived in a well for three hundred years and has as many heads as the well has had visitors.', 15, 'monstrosity', 'Large', 290, 17, [24, 12, 24, 3, 12, 8], 15, 4, 10, 8, art('serpent', '#3a6b4a', '#1e3d2a', '#8dff5a', '#ffd23f', ['spikes', 'fins'], 1.15), 30),

  // ── Things that end campaigns (CR 16 – 24) ──
  m('lich_of_the_drowned_choir', 'Lich of the Drowned Choir', 'A lich who drowned a cathedral to keep its choir singing, and conducts them still from beneath the water.', 17, 'undead', 'Medium', 260, 18, [12, 18, 20, 22, 18, 20], 16, 4, 8, 6, art('wraith', '#2a4a5a', '#152a33', '#8dd8ff', '#9fe8ff', ['crown', 'staff', 'glow'], 1.1)),
  m('ancient_amber_dragon', 'Ancient Amber Dragon', 'A dragon whose breath is time itself, slowed to a crawl; things it breathes on are found centuries later, still falling.', 20, 'dragon', 'Large', 380, 21, [28, 12, 26, 20, 18, 22], 17, 4, 10, 9, art('flyer', '#d8963c', '#8a5a22', '#ffe08a', '#ffd23f', ['horns', 'wings', 'tail', 'spikes', 'crown'], 1.15), 80),
  m('titan_of_the_first_forge', 'Titan of the First Forge', 'The giant who made the first anvil, and the first hammer, and has not put the hammer down.', 21, 'giant', 'Large', 420, 20, [30, 10, 28, 18, 16, 18], 18, 4, 12, 10, art('brute', '#b8963c', '#6f5a22', '#ff9a3c', '#ff5a3c', ['weapon', 'flames', 'crown'], 1.15), 40),
  m('void_spawn_of_the_deep', 'Spawn of the Deep Void', 'Something from the space between the stars that fell into the deep places, and is still falling, and takes things with it.', 19, 'aberration', 'Large', 340, 19, [26, 16, 24, 22, 20, 20], 16, 4, 10, 8, art('orb', '#1a1a2a', '#0a0a14', '#b8a8ff', '#b8ff5a', ['tentacles', 'glow'], 1.15), 30),
  m('archfiend_of_bargains', 'Archfiend of Bargains', 'A fiend who has never broken a contract and has never signed one anyone could survive.', 22, 'fiend', 'Large', 400, 21, [26, 18, 24, 24, 20, 26], 18, 4, 10, 8, art('biped', '#5a1a2a', '#331018', '#ffd23f', '#ff5a3c', ['horns', 'wings', 'cloak', 'crown', 'flames'], 1.15), 40),
  m('seraph_of_the_last_gate', 'Seraph of the Last Gate', 'An angel set to guard the last door, who has been told to let no one through, and has been told nothing else in ten thousand years.', 23, 'celestial', 'Large', 440, 22, [28, 20, 26, 20, 24, 26], 19, 4, 10, 10, art('biped', '#ffe08a', '#c9a040', '#ffffff', '#ffffff', ['wings', 'halo', 'weapon', 'shield', 'glow'], 1.15), 60),
];

/** Which themes each new creature belongs to, merged into `THEME_MONSTERS`. */
export const EXPANSION_THEMES: Record<string, string[]> = {
  goblin_warren: ['gutter_kobold', 'goblin_ratcatcher', 'pit_kobold_slinger', 'hedge_gnoll', 'blackpowder_goblin', 'kobold_scale_sorcerer', 'gnoll_flesh_gnawer', 'hobgoblin_ironsmith', 'orc_grave_singer', 'hill_giant_runt', 'ogre_gaoler', 'gnoll_bone_shaman', 'quarry_troll_whelp', 'rot_grub_swarm', 'stair_crawler', 'barrow_rat', 'sewer_stirge'],
  thieves_guild_den: ['gutter_kobold', 'goblin_ratcatcher', 'bandit_arcanist', 'drain_ooze', 'sewer_stirge', 'mirror_mimic', 'web_choker', 'blackpowder_goblin', 'shade_assassin', 'vampire_duelist', 'tallow_man', 'cracked_animated_statue', 'gith_tomb_raider'],
  royal_crypt: ['hollow_hound', 'lantern_wight', 'brine_zombie', 'candle_ghost', 'grave_moth_swarm', 'tomb_moth', 'barrow_rat', 'barrow_hound', 'lamplighter_specter', 'salt_mummy', 'ghoul_gravedigger', 'bone_naga_hatchling', 'iron_cobra_tomb', 'fen_wight_lord', 'drowned_knight', 'crypt_lion', 'lich_apprentice', 'reliquary_golem', 'bog_body_colossus', 'death_knight_seneschal', 'lich_of_the_drowned_choir', 'shade_assassin'],
  sunken_temple: ['cellar_leech', 'brine_zombie', 'drain_ooze', 'mire_frog_giant', 'drowned_knight', 'sea_hag_daughter', 'fen_wight_lord', 'kraken_spawn_elder', 'ancient_hydra_of_the_well', 'lich_of_the_drowned_choir', 'salt_mummy', 'bog_body_colossus', 'marsh_troll_bride', 'vine_strangler'],
  ancient_dwarven_hall: ['duergar_stonewright', 'clay_sentinel', 'cracked_animated_statue', 'animated_siege_engine', 'bronze_bull_construct', 'reliquary_golem', 'adamant_golem_titan', 'titan_of_the_first_forge', 'quarry_troll_whelp', 'rust_wyrmling', 'iron_cobra_tomb', 'crystal_basilisk', 'stair_crawler'],
  feywild_glade: ['mud_sprite', 'thornback_hare', 'nettle_blight', 'vine_strangler', 'marsh_troll_bride', 'sea_hag_daughter', 'harrow_hag', 'hollow_treant', 'ancient_treant_warden', 'phase_panther', 'gloom_stalker_cat', 'storm_crow_swarm', 'mire_frog_giant', 'sphinx_of_the_locks'],
  shadowfell_crossing: ['hollow_hound', 'candle_ghost', 'lamplighter_specter', 'barrow_hound', 'gloom_stalker_cat', 'shade_assassin', 'lich_apprentice', 'night_hag_coven_mother', 'vampire_duelist', 'death_knight_seneschal', 'phase_panther', 'lich_of_the_drowned_choir', 'void_spawn_of_the_deep'],
  abyssal_rift: ['bog_imp', 'cinder_hound', 'abyssal_chanter', 'chain_devil_warden', 'pit_fiend_quartermaster', 'night_hag_coven_mother', 'archfiend_of_bargains', 'ash_wisp', 'flame_naga', 'ogre_gaoler'],
  elemental_node_fire: ['ash_wisp', 'cinder_hound', 'tallow_man', 'flame_naga', 'bronze_bull_construct', 'titan_of_the_first_forge', 'pit_fiend_quartermaster', 'bog_imp', 'chapel_gargoyle_chick'],
  dragon_graveyard: ['rust_wyrmling', 'wyvern_matron', 'storm_roc_fledgling', 'basilisk_king', 'gorgon_bull_elder', 'ancient_amber_dragon', 'winter_wolf_lord', 'cloud_giant_exile', 'storm_giant_widow', 'crystal_basilisk'],
  illithid_colony: ['web_choker', 'mind_flayer_lichen_lord', 'beholder_dreamer', 'void_spawn_of_the_deep', 'drow_spider_priestess', 'ettercap_weaver', 'phase_panther', 'kraken_spawn_elder'],
  wizards_tower_lore_loc: ['bandit_arcanist', 'cracked_animated_statue', 'tallow_man', 'mirror_mimic', 'clay_sentinel', 'lich_apprentice', 'reliquary_golem', 'beholder_dreamer', 'adamant_golem_titan', 'ash_wisp', 'iron_cobra_tomb', 'sphinx_of_the_locks'],
  vampire_castle: ['candle_ghost', 'hollow_hound', 'tallow_man', 'salt_mummy', 'drowned_knight', 'shade_assassin', 'vampire_duelist', 'death_knight_seneschal', 'night_hag_coven_mother', 'grave_moth_swarm', 'tomb_moth'],
  celestial_observatory: ['chapel_gargoyle_chick', 'pilgrim_gargoyle', 'reliquary_golem', 'sphinx_of_the_locks', 'storm_giant_widow', 'seraph_of_the_last_gate', 'storm_crow_swarm', 'dust_djinn_lesser'],
  // New themes.
  salt_mine_deeps: ['cellar_leech', 'drain_ooze', 'salt_mummy', 'duergar_stonewright', 'quarry_troll_whelp', 'stair_crawler', 'barrow_rat', 'rot_grub_swarm', 'crystal_basilisk', 'iron_cobra_tomb', 'clay_sentinel', 'bog_body_colossus', 'adamant_golem_titan', 'gith_tomb_raider'],
  drowned_lighthouse: ['brine_zombie', 'cellar_leech', 'sewer_stirge', 'lantern_wight', 'lamplighter_specter', 'drowned_knight', 'sea_hag_daughter', 'screech_harpy', 'storm_crow_swarm', 'kraken_spawn_elder', 'storm_roc_fledgling', 'lich_of_the_drowned_choir', 'candle_ghost'],
  plague_hospice: ['rot_grub_swarm', 'tomb_moth', 'grave_moth_swarm', 'hollow_hound', 'ghoul_gravedigger', 'nettle_blight', 'plague_priest', 'salt_mummy', 'harrow_hag', 'bog_body_colossus', 'lich_apprentice', 'mind_flayer_lichen_lord', 'vine_strangler'],
  giants_causeway: ['hill_giant_runt', 'quarry_troll_whelp', 'ogre_gaoler', 'cloud_giant_exile', 'winter_wolf_lord', 'storm_giant_widow', 'storm_roc_fledgling', 'titan_of_the_first_forge', 'animated_siege_engine', 'thornback_hare', 'dust_djinn_lesser', 'gorgon_bull_elder'],
};

/** Signature riders, resolved as real saving throws on a hit. */
export const EXPANSION_SPECIALS: Record<string, MonsterSpecial> = {
  cellar_leech: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'blood-drinking bite' },
  tomb_moth: { kind: 'unconscious', dc: 10, saveAbility: 'con', durationTurns: 1, description: 'sleeping dust' },
  bog_imp: { kind: 'poisoned', dc: 11, saveAbility: 'con', durationTurns: 2, description: 'marsh-gas sting' },
  hollow_hound: { kind: 'frightened', dc: 11, saveAbility: 'wis', durationTurns: 1, description: 'a bark with nothing behind it' },
  lantern_wight: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'the lamp\'s cold' },
  stair_crawler: { kind: 'prone', dc: 11, saveAbility: 'dex', durationTurns: 1, description: 'an ankle taken from below' },
  candle_ghost: { kind: 'blinded', dc: 11, saveAbility: 'con', durationTurns: 1, description: 'a snuffed light' },
  nettle_blight: { kind: 'poisoned', dc: 11, saveAbility: 'con', durationTurns: 2, description: 'a rash of fire' },
  barrow_hound: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'grave-cold jaws' },
  lamplighter_specter: { kind: 'blinded', dc: 12, saveAbility: 'con', durationTurns: 1, description: 'every light gone' },
  vine_strangler: { kind: 'grappled', dc: 13, saveAbility: 'str', durationTurns: 2, description: 'a vine round the throat' },
  ettercap_weaver: { kind: 'restrained', dc: 12, saveAbility: 'dex', durationTurns: 2, description: 'a web dropped from above' },
  salt_mummy: { kind: 'poisoned', dc: 12, saveAbility: 'con', durationTurns: 2, description: 'a touch that draws the water out' },
  cinder_hound: { kind: 'frightened', dc: 12, saveAbility: 'wis', durationTurns: 1, description: 'burning pawprints closing in' },
  screech_harpy: { kind: 'stunned', dc: 12, saveAbility: 'con', durationTurns: 1, description: 'a song gone bad' },
  ghoul_gravedigger: { kind: 'paralyzed', dc: 11, saveAbility: 'con', durationTurns: 2, description: 'paralysing claws' },
  web_choker: { kind: 'grappled', dc: 13, saveAbility: 'str', durationTurns: 2, description: 'a throat seized' },
  mirror_mimic: { kind: 'charmed', dc: 13, saveAbility: 'wis', durationTurns: 1, description: 'a reflection that holds the eye' },
  iron_cobra_tomb: { kind: 'poisoned', dc: 13, saveAbility: 'con', durationTurns: 3, description: 'a thousand-year venom' },
  fen_wight_lord: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'the bog\'s patience' },
  plague_priest: { kind: 'poisoned', dc: 14, saveAbility: 'con', durationTurns: 3, description: 'a contagious blessing' },
  abyssal_chanter: { kind: 'frightened', dc: 14, saveAbility: 'wis', durationTurns: 2, description: 'a voice that is enough' },
  basilisk_king: { kind: 'petrified', dc: 15, saveAbility: 'con', durationTurns: 2, description: 'the old gaze' },
  gloom_stalker_cat: { kind: 'frightened', dc: 13, saveAbility: 'wis', durationTurns: 1, description: 'the dark between torches' },
  shade_assassin: { kind: 'poisoned', dc: 15, saveAbility: 'con', durationTurns: 2, description: 'a shadow-tipped blade' },
  gorgon_bull_elder: { kind: 'petrified', dc: 16, saveAbility: 'con', durationTurns: 2, description: 'petrifying breath' },
  vampire_duelist: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'a duelist\'s bite' },
  frost_lich_servitor: { kind: 'restrained', dc: 15, saveAbility: 'str', durationTurns: 1, description: 'rime closing over the feet' },
  chain_devil_warden: { kind: 'restrained', dc: 16, saveAbility: 'dex', durationTurns: 2, description: 'animated chains' },
  mind_flayer_lichen_lord: { kind: 'stunned', dc: 16, saveAbility: 'int', durationTurns: 1, description: 'a spore-borne thought' },
  crystal_basilisk: { kind: 'petrified', dc: 17, saveAbility: 'con', durationTurns: 2, description: 'a gaze that turns flesh to glass' },
  beholder_dreamer: { kind: 'unconscious', dc: 16, saveAbility: 'wis', durationTurns: 1, description: 'a dream with eyes' },
  kraken_spawn_elder: { kind: 'grappled', dc: 17, saveAbility: 'str', durationTurns: 2, description: 'a tentacle the width of a mast' },
  night_hag_coven_mother: { kind: 'frightened', dc: 16, saveAbility: 'wis', durationTurns: 2, description: 'a night without sleep' },
  void_spawn_of_the_deep: { kind: 'stunned', dc: 18, saveAbility: 'wis', durationTurns: 1, description: 'the fall between stars' },
  ancient_amber_dragon: { kind: 'paralyzed', dc: 19, saveAbility: 'con', durationTurns: 2, description: 'breath that slows time' },
};

/** Legendary tempo for the ones that end campaigns. */
export const EXPANSION_BOSS_KITS: Record<string, BossKit> = {
  lich_of_the_drowned_choir: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Drowned Note', description: 'a chord that fills the lungs with water', damage: '3d6', damageBonus: 4, saveAbility: 'con', dc: 18, condition: 'stunned', durationTurns: 1 },
      { name: 'Choir Rises', description: 'the drowned singers turn as one', damage: '2d8', damageBonus: 2 },
      { name: 'Conductor\'s Glance', description: 'a look that stops the heart a beat', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'The Water Rises', description: 'black water climbs the walls a hand\'s breadth', damage: '2d6', saveAbility: 'con', dc: 16 },
      { name: 'Bells Below', description: 'a drowned bell tolls and the floor shudders', saveAbility: 'dex', dc: 16, condition: 'prone', durationTurns: 1 },
    ],
  },
  ancient_amber_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail Sweep', description: 'a tail heavy as a falling tree', damage: '2d8', damageBonus: 9, saveAbility: 'dex', dc: 20, condition: 'prone', durationTurns: 1 },
      { name: 'Amber Breath', description: 'a slow gold exhalation', damage: '4d8', saveAbility: 'con', dc: 21, condition: 'paralyzed', durationTurns: 1 },
      { name: 'Wing Buffet', description: 'wings that put out the torches', damage: '2d6', damageBonus: 9 },
    ],
    lair: [
      { name: 'Time Thickens', description: 'the air goes heavy as honey', saveAbility: 'str', dc: 17, condition: 'restrained', durationTurns: 1 },
      { name: 'Old Light', description: 'a century of sunsets falls through the ceiling', damage: '2d8', saveAbility: 'dex', dc: 17 },
    ],
  },
  titan_of_the_first_forge: {
    legendaryResistances: 3,
    legendary: [
      { name: 'First Hammer', description: 'the hammer that made the anvil', damage: '4d10', damageBonus: 10, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Quench', description: 'a hiss of steam from the trough', damage: '3d6', saveAbility: 'con', dc: 19, condition: 'blinded', durationTurns: 1 },
      { name: 'Anvil Ring', description: 'a note that shakes the teeth', damage: '2d8', saveAbility: 'con', dc: 19, condition: 'deafened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Sparks', description: 'the forge throws a sheet of sparks', damage: '2d6', saveAbility: 'dex', dc: 17 },
      { name: 'Bellows', description: 'the great bellows breathe and the room becomes an oven', damage: '2d8', saveAbility: 'con', dc: 17 },
    ],
  },
  void_spawn_of_the_deep: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Reach', description: 'a limb from somewhere else', damage: '3d8', damageBonus: 8, saveAbility: 'str', dc: 19, condition: 'grappled', durationTurns: 2 },
      { name: 'Unmaking Gaze', description: 'a look from between the stars', saveAbility: 'wis', dc: 19, condition: 'stunned', durationTurns: 1 },
      { name: 'Falling', description: 'the floor is briefly not there', damage: '3d6', saveAbility: 'dex', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Stars Go Out', description: 'every light dims to a pinprick', saveAbility: 'con', dc: 17, condition: 'blinded', durationTurns: 1 },
      { name: 'Gravity Turns', description: 'down is briefly sideways', damage: '2d8', saveAbility: 'dex', dc: 17 },
    ],
  },
  archfiend_of_bargains: {
    legendaryResistances: 4,
    legendary: [
      { name: 'Clause', description: 'a term of the contract, read aloud', damage: '3d8', damageBonus: 8, saveAbility: 'cha', dc: 21, condition: 'charmed', durationTurns: 1 },
      { name: 'Penalty', description: 'the price of default, taken', damage: '4d6', damageBonus: 8 },
      { name: 'Signature', description: 'a name written in fire on the air', saveAbility: 'wis', dc: 20, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Fine Print', description: 'the walls crawl with script', damage: '2d8', saveAbility: 'int', dc: 18 },
      { name: 'Escrow', description: 'a member\'s shadow is held as collateral', saveAbility: 'cha', dc: 18, condition: 'restrained', durationTurns: 1 },
    ],
  },
  seraph_of_the_last_gate: {
    legendaryResistances: 4,
    legendary: [
      { name: 'Gate-Blade', description: 'a sword that has never been sheathed', damage: '4d8', damageBonus: 10 },
      { name: 'Radiance', description: 'light that has forgotten mercy', damage: '3d8', saveAbility: 'con', dc: 21, condition: 'blinded', durationTurns: 1 },
      { name: 'The Word', description: 'a single syllable of the first language', saveAbility: 'wis', dc: 21, condition: 'stunned', durationTurns: 1 },
    ],
    lair: [
      { name: 'The Gate Trembles', description: 'the last door shudders in its frame', damage: '2d8', saveAbility: 'dex', dc: 18 },
      { name: 'Choir of the Threshold', description: 'voices from beyond the door', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 1 },
    ],
  },
};

export { m as defineMonster };
