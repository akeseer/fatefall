/**
 * The menagerie: twenty-five kinds of creature the bestiary did not have,
 * two of each, and the ten new zones they live in.
 *
 * Insects and arachnids, the aquatic and the avian, reptiles and dinosaurs,
 * fungus and crystal, automata, shapechangers, lycanthropes and vampires,
 * spirits, demons, devils and yugoloths, genies, hags, titans, wyrms,
 * parasites, cultists, far-realm outsiders, the dreamborn and the shades.
 * `MonsterKinds` says what the rules make of each; this file is the data.
 */

import type { MonsterTemplate } from './Monster';
import type { MonsterSpecial, BossKit } from '../rules/Rules';
import { defineMonster as m, art } from './MonsterExpansion';

export const MENAGERIE_MONSTERS: MonsterTemplate[] = [
  // insect
  m('lantern_beetle_giant', 'Giant Lantern Beetle', 'A beetle the size of a hound whose abdomen burns with a cold green light that draws moths, and things that eat moths, and things that eat those.', 1, 'insect', 'Medium', 20, 14, [12, 10, 14, 1, 8, 3], 4, 1, 8, 2, art('spider', '#3c5a2e', '#1f3018', '#8dff5a', '#b8ff5a', ['glow', 'shell']), 30),
  m('locust_tyrant', 'Locust Tyrant', 'The one locust in a plague that is the size of a horse, and the reason the rest of the plague goes where it goes.', 6, 'insect', 'Large', 95, 15, [17, 16, 16, 4, 12, 8], 8, 2, 8, 4, art('flyer', '#8a7a3c', '#4f4622', '#e0c08a', '#ff5a3c', ['wings', 'spikes', 'crown'], 1.15), 50),
  // arachnid
  m('cellar_widow', 'Cellar Widow', 'A spider that has learned wine cellars: it nests behind the oldest casks and takes the hand that reaches for them.', 0.5, 'arachnid', 'Small', 12, 13, [8, 16, 12, 2, 11, 4], 4, 1, 6, 2, art('spider', '#1e1e24', '#0d0d10', '#ff5a3c', '#ff5a3c', ['fangs'], 0.8), 30),
  m('tomb_weaver_queen', 'Tomb Weaver Queen', 'A spider grown fat on the dead of a whole dynasty, whose web is the size of a hall and older than the kingdom above it.', 9, 'arachnid', 'Large', 150, 16, [20, 15, 18, 7, 14, 10], 10, 2, 10, 5, art('spider', '#4a3a5a', '#2a2036', '#d8d8f0', '#ff5a3c', ['fangs', 'crown', 'spikes'], 1.15), 30),
  // aquatic
  m('reef_lurker', 'Reef Lurker', 'A fish with a face, more or less, that waits in flooded corridors and takes whatever wades in up to the knee.', 2, 'aquatic', 'Medium', 34, 13, [15, 13, 14, 3, 12, 5], 5, 1, 8, 3, art('quadruped', '#2a5a6a', '#153036', '#8dd8ff', '#ffd23f', ['fins', 'fangs']), 20),
  m('leviathan_calf', 'Leviathan Calf', 'The child of something that lives under the sea floor; it has surfaced into a cistern and cannot get back, and is very unhappy.', 11, 'aquatic', 'Large', 180, 16, [24, 10, 22, 4, 12, 8], 11, 3, 10, 7, art('serpent', '#1e3a5a', '#0f1e30', '#8dd8ff', '#b8ff5a', ['fins', 'spikes'], 1.15), 30),
  // avian
  m('gallows_crow', 'Gallows Crow', 'A crow that roosts on gibbets and has learned that the living become the dead if you are patient, or helpful.', 0.25, 'avian', 'Small', 7, 13, [5, 16, 10, 5, 12, 6], 4, 1, 4, 2, art('flyer', '#1e1e28', '#0d0d12', '#5a5a70', '#ffd23f', ['claws'], 0.7), 50),
  m('thunder_condor', 'Thunder Condor', 'A condor that nests in storm clouds and carries the storm down with it on each wing.', 7, 'avian', 'Large', 110, 14, [19, 16, 16, 4, 14, 9], 9, 2, 8, 4, art('flyer', '#3a3a4a', '#1e1e2a', '#8dd8ff', '#ffd23f', ['wings', 'claws', 'glow'], 1.15), 90),
  // reptile
  m('cistern_croc', 'Cistern Crocodile', 'A crocodile that went into the city\'s cisterns as a hatchling and has come out only once, and that once is now.', 3, 'reptile', 'Large', 55, 13, [18, 10, 16, 2, 10, 5], 6, 1, 10, 4, art('quadruped', '#3c5a3a', '#1f301e', '#8a9a6a', '#ffd23f', ['tail', 'fangs', 'spikes'], 1.15), 30),
  m('sunning_wyrmlizard', 'Sunning Wyrmlizard', 'A lizard with a dragon somewhere in its line, which has left it a breath of hot sand and a temper.', 5, 'reptile', 'Large', 80, 15, [17, 14, 16, 5, 11, 8], 7, 2, 8, 4, art('quadruped', '#c9963c', '#7a5a22', '#ffe08a', '#ffd23f', ['tail', 'spikes', 'horns'], 1.12), 40),
  // dinosaur
  m('hall_raptor', 'Hall Raptor', 'A raptor that hunts in stone corridors as its ancestors hunted in tall grass, and finds them just as good.', 2, 'dinosaur', 'Medium', 36, 14, [15, 17, 14, 4, 12, 6], 5, 1, 8, 3, art('quadruped', '#5a7a4a', '#2f4226', '#c9d97a', '#ffd23f', ['tail', 'claws', 'fangs']), 50),
  m('tomb_thunderer', 'Tomb Thunderer', 'A three-horned beast the size of a barn, interred with a king as a mount for the next world, and woken to find the world the same as ever.', 8, 'dinosaur', 'Large', 140, 16, [24, 9, 20, 2, 11, 5], 10, 2, 12, 6, art('quadruped', '#6a6a5a', '#3a3a30', '#c9b58a', '#ff5a3c', ['horns', 'tail', 'shell'], 1.15), 40),
  // fungus
  m('spore_shepherd', 'Spore Shepherd', 'A walking fungus that tends a flock of smaller fungi, and defends it the way any shepherd would, with more spores.', 3, 'fungus', 'Medium', 48, 12, [14, 8, 16, 6, 12, 5], 5, 1, 8, 3, art('tree', '#8a6a9a', '#4e3c58', '#d8b8f0', '#b8ff5a', ['staff'], 0.95), 20),
  m('undergrowth_mind', 'The Undergrowth Mind', 'A fungal network the size of a floor that has been thinking for a thousand years and has just now noticed the party walking on it.', 12, 'fungus', 'Large', 210, 15, [20, 6, 22, 18, 16, 12], 12, 3, 8, 6, art('tree', '#5a4a7a', '#2f2640', '#b8a8ff', '#b8ff5a', ['glow', 'tentacles', 'crown'], 1.15), 10),
  // crystal
  m('shardling', 'Shardling', 'A crystal that grew legs, or a creature that grew crystal; it is not clear which, and it cuts either way.', 1, 'crystal', 'Small', 18, 15, [10, 14, 14, 3, 10, 3], 4, 1, 6, 2, art('biped', '#9fb0d8', '#5a6a8a', '#e8f4ff', '#8dd8ff', ['spikes', 'glow'], 0.8), 30),
  m('prism_colossus', 'Prism Colossus', 'A giant of living crystal that splits every light that touches it into a spear.', 13, 'crystal', 'Large', 230, 19, [26, 8, 24, 6, 12, 8], 13, 3, 10, 8, art('brute', '#b8c8f0', '#6a7a9a', '#ffffff', '#8dd8ff', ['spikes', 'glow', 'crown'], 1.15), 30),
  // automaton
  m('tin_soldier', 'Tin Soldier', 'A wind-up soldier the height of a man, still marching the patrol it was wound for a century ago.', 1, 'automaton', 'Medium', 22, 15, [14, 10, 14, 1, 6, 1], 4, 1, 8, 2, art('biped', '#b8963c', '#6f5a22', '#ff5a3c', '#ffffff', ['weapon', 'shield']), 25),
  m('clockwork_reaper', 'Clockwork Reaper', 'A harvesting machine built for wheat, which somebody later taught about other crops.', 9, 'automaton', 'Large', 150, 18, [22, 14, 20, 3, 10, 1], 10, 3, 8, 6, art('brute', '#4a4a5a', '#2a2a33', '#b8963c', '#ff5a3c', ['weapon', 'spikes'], 1.15), 30),
  // shapechanger
  m('face_thief', 'Face Thief', 'A thing with no face of its own, which is why it collects them.', 3, 'shapechanger', 'Medium', 45, 14, [12, 17, 14, 13, 12, 15], 6, 2, 6, 3, art('biped', '#c9b0a0', '#7a6558', '#f0d6d0', '#3a1c1c', ['cloak', 'hood'])),
  m('thousand_faced', 'The Thousand-Faced', 'A shapechanger so old it has forgotten it was ever anything, and shifts through a hundred shapes in a fight, each of them someone the party has lost.', 10, 'shapechanger', 'Medium', 160, 17, [18, 20, 18, 16, 16, 20], 11, 3, 8, 5, art('wraith', '#c9b0a0', '#7a6558', '#f0d6d0', '#ffffff', ['crown', 'glow'])),
  // lycanthrope
  m('wererat_skulker', 'Wererat Skulker', 'A wererat that keeps to the rat shape by preference, since people do not look at rats.', 2, 'lycanthrope', 'Medium', 33, 13, [11, 16, 13, 11, 10, 8], 5, 1, 6, 3, art('quadruped', '#5e5045', '#372d26', '#c9a56a', '#ff5a3c', ['fangs', 'tail', 'hood'], 0.9), 40),
  m('werebear_hermit', 'Werebear Hermit', 'A hermit who went into the mountains to master the bear, and came down having made his peace with losing.', 6, 'lycanthrope', 'Large', 100, 13, [20, 12, 18, 11, 13, 12], 8, 2, 8, 5, art('quadruped', '#6a4a2a', '#3e2a16', '#c9a56a', '#ffd23f', ['claws', 'fangs', 'mane'], 1.15), 40),
  // vampire
  m('fledgling_vampire', 'Fledgling Vampire', 'Turned last month, still surprised by it, and hungrier than anything that has had time to learn restraint.', 4, 'vampire', 'Medium', 60, 15, [16, 16, 16, 11, 10, 14], 6, 1, 8, 4, art('biped', '#3a2a3a', '#1e151e', '#ff5a3c', '#ff5a3c', ['fangs', 'cloak'])),
  m('vampire_countess', 'Vampire Countess', 'A countess who has outlived her county, her country and the language its name was in, and keeps a very good table.', 14, 'vampire', 'Medium', 230, 19, [20, 20, 20, 18, 17, 22], 14, 3, 8, 6, art('biped', '#5a1a2a', '#331018', '#ffd23f', '#ff5a3c', ['fangs', 'cloak', 'crown', 'wings'])),
  // spirit
  m('hearth_spirit_wronged', 'Wronged Hearth Spirit', 'A house-spirit whose house was burned, which has followed the party from the ashes and has not decided yet whether they did it.', 1, 'spirit', 'Small', 16, 13, [4, 15, 12, 10, 13, 12], 4, 1, 6, 2, art('orb', '#ff9a3c', '#b8501e', '#ffe08a', '#ffffff', ['flames'], 0.7), 40),
  m('spirit_of_the_drowned_mill', 'Spirit of the Drowned Mill', 'The mill went under with the miller in it, and the wheel has turned ever since on a river that is not there.', 7, 'spirit', 'Large', 105, 14, [12, 16, 14, 12, 16, 16], 9, 2, 8, 4, art('wraith', '#5f7a8a', '#34464f', '#8dd8ff', '#9fe8ff', ['glow', 'chains'], 1.12), 30),
  // demon
  m('gnasher_demon', 'Gnasher', 'A demon that is mostly mouth, which is all a demon needs.', 3, 'demon', 'Medium', 50, 14, [17, 12, 16, 5, 9, 7], 6, 2, 6, 3, art('brute', '#6a2a2a', '#3e1818', '#ff9a3c', '#ff5a3c', ['fangs', 'horns', 'claws'], 0.95)),
  m('demon_of_the_broken_oath', 'Demon of the Broken Oath', 'Every oath sworn and broken in a kingdom, given a shape, and the shape is hungry.', 15, 'demon', 'Large', 260, 19, [26, 16, 24, 16, 14, 20], 15, 4, 8, 8, art('brute', '#4a1a2a', '#2a0f18', '#ff5a3c', '#ffd23f', ['horns', 'wings', 'chains', 'flames', 'crown'], 1.15), 40),
  // devil
  m('contract_devil_clerk', 'Contract Clerk', 'A minor devil of the infernal bureaucracy, sent to collect on a debt the party did not know it owed.', 4, 'devil', 'Medium', 58, 15, [13, 15, 15, 17, 14, 17], 6, 2, 6, 3, art('biped', '#7a2a2a', '#4a1818', '#ffd23f', '#ff5a3c', ['horns', 'staff', 'cloak'])),
  m('devil_of_the_ninth_ledger', 'Devil of the Ninth Ledger', 'The devil who keeps the last book, in which every debt is finally settled.', 16, 'devil', 'Large', 270, 20, [24, 18, 24, 22, 20, 24], 16, 4, 8, 8, art('brute', '#5a1a1a', '#331010', '#ffd23f', '#ff9a3c', ['horns', 'wings', 'weapon', 'crown', 'flames'], 1.15), 40),
  // yugoloth
  m('coin_yugoloth', 'Coin Yugoloth', 'A mercenary fiend that fights for whoever paid last, and checks who that was between blows.', 5, 'yugoloth', 'Medium', 75, 16, [16, 16, 16, 13, 12, 14], 7, 2, 8, 4, art('biped', '#5a5a3a', '#333320', '#ffd23f', '#b8ff5a', ['weapon', 'shield', 'horns'])),
  m('yugoloth_broker', 'Yugoloth Broker', 'A fiend that brokers wars between the other fiends, and has come to see whether this one is worth investing in.', 12, 'yugoloth', 'Large', 190, 18, [20, 18, 20, 20, 18, 20], 12, 3, 8, 6, art('brute', '#4a4a2a', '#2a2a18', '#ffd23f', '#b8ff5a', ['horns', 'wings', 'cloak', 'crown'], 1.12), 40),
  // genie
  m('bound_djinni', 'Bound Djinni', 'A djinni bound to a bottle three owners ago, and bound to defend whichever fool holds it now.', 6, 'genie', 'Large', 100, 16, [18, 18, 18, 15, 16, 18], 8, 2, 8, 4, art('wraith', '#4a7ac9', '#2a4a7a', '#8dd8ff', '#ffffff', ['glow', 'chains'], 1.12), 60),
  m('efreeti_lamplord', 'Efreeti Lamplord', 'An efreeti who owns every lamp in the deeps, and has come to collect the rent.', 14, 'genie', 'Large', 240, 18, [24, 14, 22, 16, 15, 20], 14, 3, 10, 7, art('brute', '#c4462a', '#6e2413', '#ffe08a', '#ffe08a', ['flames', 'weapon', 'crown', 'glow'], 1.15), 50),
  // hag
  m('gutter_hag', 'Gutter Hag', 'A hag who lives in the storm drains of a city and takes a tithe of what the storms wash down.', 3, 'hag', 'Medium', 48, 14, [16, 13, 16, 13, 14, 13], 6, 1, 8, 3, art('biped', '#5c7d5c', '#334833', '#c9d97a', '#ffd23f', ['claws', 'hood'])),
  m('grandmother_of_teeth', 'Grandmother of Teeth', 'The hag the other hags are frightened of, who has a tooth from every one of them and knows what each is for.', 11, 'hag', 'Medium', 170, 17, [20, 16, 20, 18, 19, 19], 11, 3, 8, 5, art('biped', '#3a4a3a', '#1e2a1e', '#f5efe0', '#ff5a3c', ['claws', 'crown', 'cloak', 'fangs'])),
  // titan
  m('fallen_titan_hand', 'Hand of a Fallen Titan', 'A titan fell here in the first war, and the hand still moves.', 12, 'titan', 'Large', 200, 18, [28, 8, 26, 4, 10, 6], 12, 3, 12, 9, art('brute', '#9d9d9d', '#5f5f5f', '#c9b58a', '#ffffff', ['claws'], 1.15), 20),
  m('sleeping_titan', 'The Sleeping Titan', 'A titan asleep since the making of the world, whom the party has, regrettably, woken.', 22, 'titan', 'Large', 450, 21, [30, 10, 30, 20, 20, 22], 18, 4, 12, 10, art('brute', '#8a7a6a', '#4e4238', '#ffd23f', '#ffffff', ['crown', 'glow', 'shell'], 1.15), 40),
  // wyrm
  m('bog_wyrm', 'Bog Wyrm', 'A wingless dragon-kin that swims the peat like water and surfaces under whoever stands still.', 5, 'wyrm', 'Large', 85, 15, [19, 12, 18, 7, 12, 9], 7, 2, 8, 4, art('serpent', '#4a5a3a', '#2a3420', '#8dff5a', '#ffd23f', ['spikes', 'horns'], 1.15), 30),
  m('undermountain_wyrm', 'The Undermountain Wyrm', 'The wyrm the mountain was built over, which is why the mountain is shaped like that.', 18, 'wyrm', 'Large', 330, 20, [28, 12, 26, 14, 15, 16], 17, 4, 10, 9, art('serpent', '#3a3a4a', '#1e1e2a', '#ff9a3c', '#ff5a3c', ['spikes', 'horns', 'crown', 'flames'], 1.15), 40),
  // parasite
  m('brain_leech', 'Brain Leech', 'A leech that goes for the ear, and is very hard to argue with after.', 1, 'parasite', 'Small', 9, 12, [3, 16, 12, 6, 12, 4], 4, 1, 4, 1, art('serpent', '#8a5a6a', '#4e3340', '#f0d6d0', '#b8ff5a', ['glow'], 0.65), 20),
  m('host_walker', 'Host Walker', 'A body that is entirely full of something else, walking where the something else tells it to.', 7, 'parasite', 'Medium', 110, 13, [18, 12, 20, 9, 12, 6], 9, 2, 8, 5, art('biped', '#6a7a5a', '#3a4230', '#b8ff5a', '#b8ff5a', ['tentacles', 'glow'])),
  // cultist
  m('knife_cultist', 'Knife Cultist', 'A cultist with one knife, one prayer, and no plans past the end of either.', 0.5, 'cultist', 'Medium', 11, 12, [11, 13, 11, 10, 11, 12], 3, 1, 4, 2, art('biped', '#4a2a4a', '#2a182a', '#ff5a3c', '#ffffff', ['hood', 'weapon'])),
  m('cult_hierophant', 'Cult Hierophant', 'The one who reads the book to the others, and has read further than any of them.', 8, 'cultist', 'Medium', 120, 15, [12, 14, 16, 17, 18, 19], 9, 3, 8, 4, art('biped', '#3a1a4a', '#22102a', '#ffd23f', '#b8ff5a', ['hood', 'staff', 'crown', 'glow'])),
  // outsider
  m('far_realm_finger', 'Finger of the Far Realm', 'Something has reached through a crack in the world, and this is one finger.', 6, 'outsider', 'Large', 95, 15, [18, 16, 18, 10, 12, 12], 8, 2, 8, 4, art('serpent', '#2a3a4a', '#15202a', '#b8a8ff', '#b8ff5a', ['tentacles', 'glow'], 1.12), 30),
  m('thing_from_the_gap', 'The Thing from the Gap', 'It came through the gap between two seconds, and it is still, in some sense, coming through.', 17, 'outsider', 'Large', 300, 19, [24, 20, 24, 20, 18, 18], 16, 4, 10, 8, art('orb', '#1a2a3a', '#0d151f', '#b8a8ff', '#b8ff5a', ['tentacles', 'glow', 'spikes'], 1.15), 40),
  // dreamborn
  m('nightmare_lamb', 'Nightmare Lamb', 'A lamb from a child\'s bad dream, with too many teeth and a voice like the child\'s.', 2, 'dreamborn', 'Small', 30, 13, [12, 15, 12, 6, 12, 14], 5, 1, 6, 3, art('quadruped', '#e8e0d8', '#8f8880', '#ff5a3c', '#ff5a3c', ['fangs', 'glow'], 0.8), 40),
  m('sleepers_regret', 'The Sleeper\'s Regret', 'Someone is dreaming this dungeon, and this is the part of the dream they cannot wake from.', 13, 'dreamborn', 'Large', 200, 17, [16, 20, 18, 18, 20, 22], 13, 3, 8, 6, art('wraith', '#4a3a6a', '#2a2040', '#ffd23f', '#ffffff', ['glow', 'crown', 'halo'], 1.15), 40),
  // shade
  m('alley_shade', 'Alley Shade', 'The shadow of someone who died in an alley and has not left it, and is not sure they want to.', 1, 'shade', 'Medium', 18, 13, [6, 15, 12, 8, 11, 9], 4, 1, 6, 2, art('wraith', '#2c2c36', '#111118', '#5a5a70', '#9fe8ff', [])),
  m('shade_of_the_old_king', 'Shade of the Old King', 'The king whose crypt this is, or was, still holding court in the dark for a court that is mostly dark.', 10, 'shade', 'Medium', 160, 16, [16, 18, 16, 15, 16, 19], 11, 3, 8, 5, art('wraith', '#3a3a4a', '#1e1e2a', '#ffd23f', '#9fe8ff', ['crown', 'weapon', 'cloak', 'glow'])),
];

/** The ten new zones, and who lives in them. Older creatures are drawn in by name. */
export const MENAGERIE_THEMES: Record<string, string[]> = {
  clockwork_foundry: ['tin_soldier', 'clockwork_reaper', 'shardling', 'prism_colossus', 'animated_armor', 'flying_sword', 'helmed_horror', 'shield_guardian', 'iron_golem', 'clockwork_hound', 'bronze_scout', 'nimblewright', 'rust_monster', 'magma_mephit', 'azer', 'cracked_animated_statue', 'animated_siege_engine', 'bronze_bull_construct', 'reliquary_golem', 'adamant_golem_titan', 'iron_cobra_tomb', 'coin_yugoloth', 'contract_devil_clerk', 'devil_of_the_ninth_ledger'],
  jungle_ziggurat: ['hall_raptor', 'tomb_thunderer', 'cistern_croc', 'sunning_wyrmlizard', 'lantern_beetle_giant', 'locust_tyrant', 'knife_cultist', 'cult_hierophant', 'giant_spider', 'giant_frog', 'constrictor_snake', 'giant_poisonous_snake', 'yuan_ti_malison', 'yuan_ti_abomination', 'lizardfolk', 'bullywug', 'grung', 'swarm_of_wasps', 'giant_crocodile', 'allosaurus', 'velociraptor_pack', 'deinonychus', 'couatl', 'giant_ape', 'girallon', 'stone_golem', 'gutter_hag', 'spore_shepherd', 'vine_strangler', 'bog_wyrm'],
  frozen_necropolis: ['alley_shade', 'shade_of_the_old_king', 'hearth_spirit_wronged', 'fledgling_vampire', 'vampire_countess', 'skeleton', 'zombie', 'ghoul', 'wight', 'wraith', 'specter', 'banshee', 'ghost', 'yeti', 'remorhaz', 'frost_giant_monster', 'ice_mephit', 'winter_wolf_lord', 'frost_lich_servitor', 'salt_mummy', 'death_knight_seneschal', 'mummy', 'revenant', 'crystal_basilisk', 'abominable_yeti'],
  sky_citadel: ['thunder_condor', 'gallows_crow', 'bound_djinni', 'efreeti_lamplord', 'aarakocra', 'griffon', 'hippogriff', 'pegasus', 'harpy', 'roc', 'air_elemental', 'djinni', 'cloud_giant', 'storm_giant_monster', 'giant_eagle', 'wyvern_matron', 'storm_roc_fledgling', 'cloud_giant_exile', 'storm_giant_widow', 'dust_djinn_lesser', 'screech_harpy', 'blood_hawk', 'giant_owl', 'sleeping_titan', 'fallen_titan_hand'],
  fungal_grotto: ['spore_shepherd', 'undergrowth_mind', 'brain_leech', 'host_walker', 'shardling', 'myconid', 'gas_spore', 'ochre_jelly', 'gray_ooze', 'gelatinous_cube', 'grick', 'carrion_crawler', 'darkmantle', 'piercer', 'roper', 'otyugh', 'troglodyte', 'quaggoth', 'nettle_blight', 'drain_ooze', 'cellar_leech', 'rot_grub_swarm', 'mind_flayer_lichen_lord', 'far_realm_finger'],
  pirate_cove: ['reef_lurker', 'leviathan_calf', 'gallows_crow', 'wererat_skulker', 'coin_yugoloth', 'bandit', 'bandit_captain', 'highwayman', 'thug', 'sahuagin', 'merrow', 'kuo_toa', 'merfolk', 'giant_crab', 'giant_octopus', 'shark', 'hunter_shark', 'swarm_of_quippers', 'sea_hag', 'brine_zombie', 'drowned_knight', 'sea_hag_daughter', 'kraken_spawn_elder', 'wereshark', 'sea_spawn', 'sahuagin_baron', 'lantern_wight'],
  astral_wreck: ['thing_from_the_gap', 'far_realm_finger', 'nightmare_lamb', 'sleepers_regret', 'thousand_faced', 'face_thief', 'githyanki_warrior', 'githyanki_knight', 'githzerai_monk', 'gith_tomb_raider', 'astral_dreadnought', 'marut', 'intellect_devourer', 'nothic', 'gazer', 'spectator', 'flumph', 'beholder_dreamer', 'void_spawn_of_the_deep', 'modron_quadrone', 'modron_pentadrone', 'formian_warrior', 'shardling', 'prism_colossus', 'bound_djinni'],
  desert_tomb: ['sunning_wyrmlizard', 'tomb_thunderer', 'lantern_beetle_giant', 'locust_tyrant', 'tomb_weaver_queen', 'mummy', 'mummy_lord', 'skeleton', 'giant_scorpion', 'giant_scorpion_matriarch', 'androsphinx', 'gynosphinx', 'salt_mummy', 'iron_cobra_tomb', 'crypt_lion', 'sphinx_of_the_locks', 'dust_djinn_lesser', 'efreeti_lamplord', 'lamia', 'jackalwere', 'death_dog', 'giant_vulture', 'vulture', 'fire_snake', 'dust_mephit', 'knife_cultist', 'cult_hierophant', 'shade_of_the_old_king'],
  haunted_theatre: ['alley_shade', 'face_thief', 'thousand_faced', 'hearth_spirit_wronged', 'spirit_of_the_drowned_mill', 'fledgling_vampire', 'vampire_countess', 'nightmare_lamb', 'ghost', 'specter', 'banshee', 'animated_armor', 'flying_sword', 'rug_of_smothering', 'doppelganger', 'mimic', 'mirror_mimic', 'candle_ghost', 'lamplighter_specter', 'tallow_man', 'shade_assassin', 'succubus', 'incubus', 'scarecrow', 'grave_moth_swarm', 'tomb_moth'],
  dream_labyrinth: ['nightmare_lamb', 'sleepers_regret', 'thousand_faced', 'face_thief', 'thing_from_the_gap', 'hearth_spirit_wronged', 'candle_ghost', 'will_o_wisp_monster', 'night_hag', 'night_hag_coven_mother', 'phase_spider', 'phase_panther', 'displacer_beast', 'blink_dog', 'quickling', 'boggle', 'meenlock', 'darkling', 'gloom_stalker_cat', 'mirror_mimic', 'beholder_dreamer', 'lich_apprentice', 'grandmother_of_teeth', 'gutter_hag'],
};

export const MENAGERIE_SPECIALS: Record<string, MonsterSpecial> = {
  lantern_beetle_giant: { kind: 'blinded', dc: 11, saveAbility: 'con', durationTurns: 1, description: 'a flare of cold light' },
  cellar_widow: { kind: 'poisoned', dc: 12, saveAbility: 'con', durationTurns: 3, description: 'a widow\'s bite' },
  tomb_weaver_queen: { kind: 'restrained', dc: 15, saveAbility: 'dex', durationTurns: 2, description: 'a dynasty\'s web' },
  reef_lurker: { kind: 'grappled', dc: 12, saveAbility: 'str', durationTurns: 1, description: 'jaws round the knee' },
  leviathan_calf: { kind: 'prone', dc: 16, saveAbility: 'str', durationTurns: 1, description: 'a wave in a room' },
  thunder_condor: { kind: 'deafened', dc: 14, saveAbility: 'con', durationTurns: 2, description: 'the storm on each wing' },
  cistern_croc: { kind: 'grappled', dc: 13, saveAbility: 'str', durationTurns: 2, description: 'a death roll' },
  hall_raptor: { kind: 'prone', dc: 12, saveAbility: 'dex', durationTurns: 1, description: 'a leap at the legs' },
  spore_shepherd: { kind: 'poisoned', dc: 12, saveAbility: 'con', durationTurns: 2, description: 'a flock of spores' },
  undergrowth_mind: { kind: 'stunned', dc: 16, saveAbility: 'int', durationTurns: 1, description: 'a thousand-year thought' },
  prism_colossus: { kind: 'blinded', dc: 17, saveAbility: 'con', durationTurns: 1, description: 'light split into spears' },
  clockwork_reaper: { kind: 'prone', dc: 15, saveAbility: 'dex', durationTurns: 1, description: 'the harvesting sweep' },
  face_thief: { kind: 'frightened', dc: 13, saveAbility: 'wis', durationTurns: 1, description: 'a face you know' },
  thousand_faced: { kind: 'charmed', dc: 17, saveAbility: 'wis', durationTurns: 1, description: 'someone the party lost' },
  wererat_skulker: { kind: 'poisoned', dc: 11, saveAbility: 'con', durationTurns: 2, description: 'a filthy bite' },
  fledgling_vampire: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'a clumsy, hungry bite' },
  vampire_countess: { kind: 'charmed', dc: 18, saveAbility: 'wis', durationTurns: 2, description: 'an invitation to dinner' },
  spirit_of_the_drowned_mill: { kind: 'restrained', dc: 14, saveAbility: 'str', durationTurns: 1, description: 'the wheel takes a sleeve' },
  gnasher_demon: { kind: 'grappled', dc: 13, saveAbility: 'str', durationTurns: 1, description: 'mostly mouth' },
  contract_devil_clerk: { kind: 'charmed', dc: 14, saveAbility: 'wis', durationTurns: 1, description: 'a clause read aloud' },
  yugoloth_broker: { kind: 'frightened', dc: 16, saveAbility: 'wis', durationTurns: 2, description: 'an assessment of worth' },
  bound_djinni: { kind: 'prone', dc: 15, saveAbility: 'str', durationTurns: 1, description: 'a gust from the bottle' },
  efreeti_lamplord: { kind: 'blinded', dc: 18, saveAbility: 'con', durationTurns: 1, description: 'every lamp at once' },
  gutter_hag: { kind: 'poisoned', dc: 13, saveAbility: 'con', durationTurns: 2, description: 'storm-drain claws' },
  grandmother_of_teeth: { kind: 'frightened', dc: 17, saveAbility: 'wis', durationTurns: 2, description: 'a tooth for you' },
  fallen_titan_hand: { kind: 'prone', dc: 17, saveAbility: 'str', durationTurns: 1, description: 'a hand the size of a cart' },
  bog_wyrm: { kind: 'grappled', dc: 14, saveAbility: 'str', durationTurns: 2, description: 'the peat closing over' },
  brain_leech: { kind: 'stunned', dc: 11, saveAbility: 'con', durationTurns: 1, description: 'the ear' },
  host_walker: { kind: 'poisoned', dc: 14, saveAbility: 'con', durationTurns: 3, description: 'what is inside, getting out' },
  far_realm_finger: { kind: 'frightened', dc: 14, saveAbility: 'wis', durationTurns: 1, description: 'the wrong geometry' },
  nightmare_lamb: { kind: 'frightened', dc: 12, saveAbility: 'wis', durationTurns: 1, description: 'the child\'s voice' },
  alley_shade: { kind: 'drain', dc: 0, saveAbility: 'con', durationTurns: 0, description: 'a cold hand from the dark' },
  shade_of_the_old_king: { kind: 'frightened', dc: 16, saveAbility: 'wis', durationTurns: 2, description: 'a king\'s displeasure' },
};

export const MENAGERIE_BOSS_KITS: Record<string, BossKit> = {
  sleeping_titan: {
    legendaryResistances: 4,
    legendary: [
      { name: 'Waking Fist', description: 'a fist that has not closed since the world was made', damage: '4d12', damageBonus: 10, saveAbility: 'str', dc: 22, condition: 'prone', durationTurns: 1 },
      { name: 'Yawn', description: 'a breath that was the first wind', damage: '3d8', saveAbility: 'con', dc: 20, condition: 'deafened', durationTurns: 2 },
      { name: 'Old Dream', description: 'the titan dreams the party is not there', saveAbility: 'wis', dc: 20, condition: 'stunned', durationTurns: 1 },
    ],
    lair: [
      { name: 'The Ground Turns Over', description: 'the titan shifts in its sleep and the floor tilts', damage: '2d10', saveAbility: 'dex', dc: 18 },
      { name: 'Mountain Breath', description: 'dust of ages pours from the ceiling', saveAbility: 'con', dc: 18, condition: 'blinded', durationTurns: 1 },
    ],
  },
  undermountain_wyrm: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Coil', description: 'a coil the width of a hall', damage: '3d10', damageBonus: 9, saveAbility: 'str', dc: 20, condition: 'grappled', durationTurns: 2 },
      { name: 'Deep Fire', description: 'a breath from under the mountain', damage: '4d8', saveAbility: 'dex', dc: 20 },
      { name: 'Tremor', description: 'the wyrm shifts and the mountain shifts with it', saveAbility: 'dex', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'The Mountain Settles', description: 'stone groans as the mountain remembers its shape', damage: '2d8', saveAbility: 'dex', dc: 17 },
      { name: 'Vents Open', description: 'hot air roars up through cracks in the floor', damage: '2d6', saveAbility: 'con', dc: 17 },
    ],
  },
  thing_from_the_gap: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Between Seconds', description: 'it is briefly everywhere', damage: '3d8', damageBonus: 8 },
      { name: 'Unfolding', description: 'a shape that should not fit in the room, fitting', saveAbility: 'wis', dc: 19, condition: 'stunned', durationTurns: 1 },
      { name: 'Reach Through', description: 'a limb from the gap', damage: '2d10', damageBonus: 8, saveAbility: 'str', dc: 19, condition: 'grappled', durationTurns: 1 },
    ],
    lair: [
      { name: 'The Gap Widens', description: 'the seams of the room come apart a little', damage: '2d8', saveAbility: 'dex', dc: 17 },
      { name: 'Wrong Angles', description: 'the corners of the room stop adding up', saveAbility: 'int', dc: 17, condition: 'frightened', durationTurns: 1 },
    ],
  },
  devil_of_the_ninth_ledger: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Entry', description: 'a name written in the last book', damage: '3d8', damageBonus: 8, saveAbility: 'cha', dc: 20, condition: 'frightened', durationTurns: 2 },
      { name: 'Balance Due', description: 'a debt called in full', damage: '4d6', damageBonus: 8 },
      { name: 'Audit', description: 'every sin, read in order', saveAbility: 'wis', dc: 19, condition: 'stunned', durationTurns: 1 },
    ],
    lair: [
      { name: 'The Ledger Opens', description: 'pages turn themselves and the air grows hot', damage: '2d8', saveAbility: 'con', dc: 17 },
      { name: 'Ink', description: 'black ink pools and grips the feet', saveAbility: 'str', dc: 17, condition: 'restrained', durationTurns: 1 },
    ],
  },
};
