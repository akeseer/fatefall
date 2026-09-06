/**
 * Composed monster art.
 *
 * Most creatures in the bestiary have a hand-drawn routine in `Sprites`. For
 * the rest — the expansion and any older entry without one — a sprite is
 * composed from parts on the same 28-unit grid the hand art uses: a body
 * (biped, brute, quadruped, serpent, blob, flyer, spider, orb, swarm, tree,
 * wraith), a palette, and traits (horns, wings, tail, spikes, a crown, a
 * weapon, tusks, tentacles, a halo...). A template with no spec of its own
 * gets one derived from its type and name, so no creature ever wears the
 * goblin's face by default. Pure: the composer draws through the same
 * `r(color, x, y, w, h)` grid function the hand routines use.
 */

import type { MonsterTemplate } from './Monster';

export type ArtBody =
  | 'biped' | 'brute' | 'quadruped' | 'serpent' | 'blob' | 'flyer'
  | 'spider' | 'orb' | 'swarm' | 'tree' | 'wraith';

export type ArtTrait =
  | 'horns' | 'wings' | 'tail' | 'spikes' | 'crown' | 'weapon' | 'shield'
  | 'glow' | 'tusks' | 'tentacles' | 'halo' | 'cloak' | 'fangs' | 'claws'
  | 'antlers' | 'hood' | 'mane' | 'fins' | 'shell' | 'staff' | 'bow' | 'chains' | 'flames' | 'frost';

export interface MonsterArtSpec {
  body: ArtBody;
  /** Main colour, its shadow, an accent for details, and the eyes. */
  palette: { main: string; dark: string; accent: string; eye: string };
  traits: ArtTrait[];
  /** Scale about the feet: 0.7 for something small, 1.15 for something huge. */
  scale?: number;
}

export type Grid = (color: string, x: number, y: number, w: number, h: number) => void;

/** A deterministic hash for palette and pose variety. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`;
}

/** A palette from a hue: main, a darker shade, a warmer accent, and eyes that read against it. */
export function paletteFor(hue: number, sat = 45, light = 42, eye = '#ffd23f'): MonsterArtSpec['palette'] {
  return { main: hsl(hue, sat, light), dark: hsl(hue, sat, Math.max(8, light - 18)), accent: hsl((hue + 40) % 360, Math.min(90, sat + 20), Math.min(75, light + 22)), eye };
}

const TYPE_HUE: Record<MonsterTemplate['type'], [hue: number, sat: number, light: number, eye: string]> = {
  beast: [28, 40, 38, '#ffd23f'],
  undead: [140, 12, 40, '#9fe8ff'],
  humanoid: [30, 35, 48, '#ffffff'],
  dragon: [0, 55, 40, '#ffd23f'],
  aberration: [280, 40, 42, '#b8ff5a'],
  fiend: [355, 60, 36, '#ff5a3c'],
  giant: [22, 35, 45, '#ffffff'],
  monstrosity: [50, 40, 40, '#ffd23f'],
  ooze: [110, 55, 42, '#e8ffb0'],
  construct: [210, 12, 45, '#8ad0ff'],
  fey: [300, 45, 52, '#ffffff'],
  celestial: [45, 60, 62, '#ffffff'],
  plant: [95, 40, 32, '#ffd23f'],
  elemental: [200, 60, 48, '#ffffff'],
};

const BODY_BY_NAME: [RegExp, ArtBody][] = [
  [/\b(bat|hawk|eagle|owl|raven|roc|wasp|pteranodon|quetzal|harpy|griff|hippogriff|pegasus|couatl|stirge|vulture|phoenix)\b/i, 'flyer'],
  [/\b(snake|serpent|naga|worm|viper|eel|anaconda|constrictor|boa|leech|lamprey|wyrm(?!ling))\b/i, 'serpent'],
  [/\b(spider|scorpion|crab|tick|ettercap|centipede|beetle|mite)\b/i, 'spider'],
  [/\b(swarm|cloud of|flock|shoal)\b/i, 'swarm'],
  [/\b(ooze|pudding|jelly|slime|cube|mold|blob|amoeba|gelatin)\b/i, 'blob'],
  [/\b(beholder|eye|gauth|spectator|gazer|orb|wisp|sphere|mote)\b/i, 'orb'],
  [/\b(treant|tree|blight|shambling|vine|mound|myconid|fungus|shrub|woad)\b/i, 'tree'],
  [/\b(ghost|wraith|specter|spectre|shadow|phantom|banshee|poltergeist|shade|revenant|wisp)\b/i, 'wraith'],
  [/\b(giant|ogre|troll|titan|colossus|golem|juggernaut|cyclops|ettin|fomorian|oni|goristro)\b/i, 'brute'],
  [/\b(wolf|dog|hound|bear|boar|lion|tiger|cat|elk|horse|pony|rat|goat|badger|weasel|ape|rhino|elephant|mammoth|lizard|crocodile|drake|dinosaur|raptor|rex|stego|tricera|bulette|ankheg|displacer|owlbear|worg|mastiff|jackal|hyena|panther|leucrotta|basilisk|behir|gorgon|chimera|manticore|sphinx|hydra|frog|toad|turtle)\b/i, 'quadruped'],
];

/** A spec derived from a template's type and name, for anything without one of its own. */
export function artForTemplate(t: Pick<MonsterTemplate, 'id' | 'name' | 'type' | 'size'>): MonsterArtSpec {
  const h = hash(t.id);
  const [hue0, sat, light, eye] = TYPE_HUE[t.type] ?? TYPE_HUE.monstrosity;
  const hue = (hue0 + ((h % 61) - 30) + 360) % 360;
  let body: ArtBody = 'biped';
  for (const [re, b] of BODY_BY_NAME) { if (re.test(t.name)) { body = b; break; } }
  if (body === 'biped') {
    if (t.type === 'dragon') body = 'flyer';
    else if (t.type === 'ooze') body = 'blob';
    else if (t.type === 'plant') body = 'tree';
    else if (t.type === 'giant' || t.type === 'construct') body = 'brute';
    else if (t.type === 'beast' || t.type === 'monstrosity') body = 'quadruped';
    else if (t.type === 'elemental') body = 'blob';
  }
  const traits: ArtTrait[] = [];
  const n = t.name;
  if (t.type === 'dragon') traits.push('horns', 'tail', 'wings');
  if (t.type === 'fiend') traits.push('horns', h % 2 ? 'wings' : 'tail');
  if (t.type === 'celestial') traits.push('wings', 'halo');
  if (t.type === 'undead' && body === 'biped') traits.push(h % 3 ? 'cloak' : 'weapon');
  if (t.type === 'aberration') traits.push('tentacles');
  if (t.type === 'elemental') traits.push('glow');
  if (/\b(king|queen|lord|lady|emperor|empress|prince|matriarch|archmage|high|elder|ancient|boss)\b/i.test(n)) traits.push('crown');
  if (/\b(knight|warrior|guard|soldier|captain|champion|veteran|legionnaire|blade|marshal)\b/i.test(n)) traits.push('weapon', 'shield');
  if (/\b(mage|wizard|shaman|priest|witch|necromancer|sorcer|warlock|druid|arcanist|conjurer|oracle)\b/i.test(n)) traits.push('staff');
  if (/\b(archer|scout|ranger|hunter|stalker)\b/i.test(n)) traits.push('bow');
  if (/\b(boar|elephant|mammoth|walrus|tusk)\b/i.test(n)) traits.push('tusks');
  if (/\b(elk|stag|deer|moose)\b/i.test(n)) traits.push('antlers');
  if (/\b(lion|mane|horse|pony)\b/i.test(n)) traits.push('mane');
  if (/\b(fire|flame|ember|magma|lava|hell|infernal|burning|salamander|azer|phoenix)\b/i.test(n)) traits.push('flames');
  if (/\b(frost|ice|snow|winter|rime|glacial|yeti)\b/i.test(n)) traits.push('frost');
  if (/\b(shark|fish|merrow|merfolk|sahuagin|kuo|deep|sea|tide|reef|kraken)\b/i.test(n)) traits.push('fins');
  if (/\b(turtle|tortoise|crab|shell|armadillo)\b/i.test(n)) traits.push('shell');
  if (/\b(chain|prison|jailer|bound|gaoler)\b/i.test(n)) traits.push('chains');
  if (/\b(dire|alpha|fang|wolf|hound|tiger|lion|vampire)\b/i.test(n)) traits.push('fangs');
  if (/\b(claw|bear|owlbear|raptor|badger)\b/i.test(n)) traits.push('claws');
  if (body === 'quadruped' && !traits.includes('tail')) traits.push('tail');
  if (/\b(hood|assassin|cultist|monk|thief|rogue)\b/i.test(n)) traits.push('hood');
  const scale = t.size === 'Large' ? 1.12 : t.size === 'Small' ? 0.8 : 1;
  return { body, palette: paletteFor(hue, sat, light, eye), traits, scale };
}

/**
 * Draw a composed monster. `r` paints on the 28-unit grid; `flash` paints
 * everything white for the hit flash. Facing left, feet on y 27.
 */
export function drawComposedMonster(r: Grid, spec: MonsterArtSpec, flash?: string): void {
  const P = spec.palette;
  const main = flash || P.main;
  const dark = flash || P.dark;
  const accent = flash || P.accent;
  const eye = flash || P.eye;
  const white = flash || '#ffffff';
  const scale = spec.scale ?? 1;
  // Scale about the feet: everything is drawn in a 28-box and moved toward
  // the bottom centre for small things, out past it for large.
  const g: Grid = (c, x, y, w, h) => {
    const cx = 14, fy = 28;
    const nx = cx + (x - cx) * scale;
    const ny = fy + (y - fy) * scale;
    r(c, nx, ny, Math.max(1, w * scale), Math.max(1, h * scale));
  };
  const has = (t: ArtTrait) => spec.traits.includes(t);

  // Things behind the body.
  if (has('wings')) {
    const wing = flash || P.dark;
    if (spec.body === 'flyer') {
      g(wing, 1, 6, 9, 3); g(wing, 2, 9, 7, 3); g(wing, 4, 12, 4, 2);
      g(wing, 18, 6, 9, 3); g(wing, 19, 9, 7, 3); g(wing, 20, 12, 4, 2);
      g(accent, 3, 7, 2, 1); g(accent, 23, 7, 2, 1);
    } else {
      g(wing, 3, 8, 6, 3); g(wing, 4, 11, 5, 5); g(wing, 19, 8, 6, 3); g(wing, 19, 11, 5, 5);
    }
  }
  if (has('halo')) { g(accent, 10, 0, 8, 1); g(accent, 9, 1, 1, 1); g(accent, 18, 1, 1, 1); }
  if (has('cloak')) { g(dark, 7, 12, 14, 12); g(dark, 6, 18, 16, 8); }

  switch (spec.body) {
    case 'biped': {
      g(main, 10, 3, 8, 8);              // head
      g(dark, 10, 9, 8, 2);              // jaw shadow
      g(main, 9, 11, 10, 9);             // torso
      g(dark, 9, 17, 10, 3);             // belt
      g(main, 6, 12, 3, 7); g(main, 19, 12, 3, 7);   // arms
      g(dark, 10, 20, 4, 8); g(dark, 15, 20, 4, 8);  // legs
      g(eye, 11, 6, 2, 2); g(eye, 15, 6, 2, 2);
      break;
    }
    case 'brute': {
      g(main, 9, 1, 10, 8);
      g(dark, 9, 7, 10, 2);
      g(main, 5, 9, 18, 11);
      g(dark, 5, 17, 18, 3);
      g(main, 1, 10, 4, 10); g(main, 23, 10, 4, 10);
      g(dark, 1, 19, 4, 3); g(dark, 23, 19, 4, 3);  // fists
      g(dark, 7, 20, 6, 8); g(dark, 15, 20, 6, 8);
      g(eye, 11, 4, 2, 2); g(eye, 16, 4, 2, 2);
      break;
    }
    case 'quadruped': {
      g(main, 6, 11, 17, 9);              // body
      g(dark, 6, 17, 17, 3);              // belly shadow
      g(main, 1, 8, 9, 7);                // head
      g(dark, 0, 12, 4, 3);               // snout
      g(main, 2, 5, 2, 3); g(main, 6, 5, 2, 3);   // ears
      g(dark, 7, 20, 3, 8); g(dark, 11, 20, 3, 8); g(dark, 16, 20, 3, 8); g(dark, 20, 20, 3, 8);
      g(eye, 4, 10, 2, 2);
      break;
    }
    case 'serpent': {
      g(main, 16, 20, 11, 6); g(dark, 16, 24, 11, 2);
      g(main, 8, 15, 12, 6); g(dark, 8, 19, 12, 2);
      g(main, 12, 10, 12, 5); g(dark, 12, 13, 12, 2);
      g(main, 1, 6, 10, 7); g(dark, 0, 10, 4, 2);   // head
      g(eye, 4, 8, 2, 2);
      g(accent, 0, 12, 3, 1);                        // tongue
      break;
    }
    case 'blob': {
      g(main, 5, 12, 18, 14); g(main, 3, 16, 22, 8); g(main, 8, 9, 12, 3);
      g(dark, 3, 22, 22, 4);
      g(accent, 9, 13, 5, 4); g(accent, 16, 15, 3, 3);    // inner lights
      g(eye, 10, 15, 2, 2); g(eye, 15, 14, 2, 2);
      break;
    }
    case 'flyer': {
      g(main, 10, 10, 8, 11);            // body
      g(dark, 10, 18, 8, 3);
      g(main, 11, 4, 7, 6);              // head
      g(dark, 9, 7, 3, 2);               // beak / snout
      g(dark, 11, 21, 2, 6); g(dark, 15, 21, 2, 6);
      g(eye, 13, 6, 2, 2);
      break;
    }
    case 'spider': {
      g(main, 13, 9, 12, 11);            // abdomen
      g(dark, 13, 16, 12, 4);
      g(main, 5, 11, 9, 7);              // cephalothorax
      g(eye, 6, 12, 2, 2); g(eye, 9, 12, 2, 2); g(eye, 7, 15, 1, 1); g(eye, 10, 15, 1, 1);
      for (let i = 0; i < 4; i++) {
        g(dark, 2 + i * 6, 18, 2, 4); g(dark, 1 + i * 6, 22, 2, 5);
        g(dark, 4 + i * 6, 6 + (i % 2), 2, 5);
      }
      g(accent, 16, 11, 5, 3);           // marking
      break;
    }
    case 'orb': {
      g(main, 9, 6, 10, 12); g(main, 7, 9, 14, 6); g(main, 11, 4, 6, 2); g(main, 11, 18, 6, 2);
      g(dark, 7, 13, 14, 2);
      g(white, 10, 8, 8, 5); g(eye, 12, 9, 4, 3); g(dark, 13, 10, 2, 1);
      for (let i = 0; i < 5; i++) { g(dark, 6 + i * 4, 19 + (i % 2) * 2, 2, 5); g(eye, 6 + i * 4, 24 + (i % 2) * 2, 2, 2); }
      break;
    }
    case 'swarm': {
      for (let i = 0; i < 16; i++) {
        const x = 2 + ((i * 7) % 23), y = 6 + ((i * 11) % 19);
        g(i % 3 ? main : dark, x, y, 2, 2); g(eye, x, y, 1, 1);
      }
      break;
    }
    case 'tree': {
      g(dark, 11, 12, 6, 16);            // trunk
      g(dark, 8, 24, 4, 4); g(dark, 16, 24, 4, 4);   // roots
      g(main, 3, 3, 22, 11); g(main, 6, 1, 16, 3); g(main, 5, 13, 18, 3);
      g(accent, 7, 4, 3, 2); g(accent, 17, 6, 3, 2);
      g(eye, 11, 15, 2, 2); g(eye, 15, 15, 2, 2);
      break;
    }
    case 'wraith': {
      g(main, 10, 3, 8, 8);
      g(dark, 10, 6, 8, 5);              // hollow face
      g(main, 8, 11, 12, 10);
      g(main, 10, 21, 8, 4); g(main, 12, 25, 4, 3);
      g(dark, 5, 13, 3, 6); g(dark, 20, 13, 3, 6);   // reaching arms
      g(eye, 11, 7, 2, 2); g(eye, 15, 7, 2, 2);
      break;
    }
  }

  // Things on top of the body. Positions assume the body above.
  const headX = spec.body === 'quadruped' ? 1 : spec.body === 'serpent' ? 1 : spec.body === 'brute' ? 9 : 10;
  const headY = spec.body === 'quadruped' ? 8 : spec.body === 'serpent' ? 6 : spec.body === 'brute' ? 1 : spec.body === 'flyer' ? 4 : 3;
  const headW = spec.body === 'brute' ? 10 : spec.body === 'quadruped' || spec.body === 'serpent' ? 9 : spec.body === 'flyer' ? 7 : 8;
  if (has('horns')) { g(accent, headX, headY - 3, 2, 3); g(accent, headX + headW - 2, headY - 3, 2, 3); g(accent, headX - 1, headY - 4, 2, 2); g(accent, headX + headW - 1, headY - 4, 2, 2); }
  if (has('antlers')) { for (let i = 0; i < 3; i++) { g(accent, headX - 1 + i, headY - 2 - i * 2, 1, 2); g(accent, headX + headW - 1 - i, headY - 2 - i * 2, 1, 2); } }
  if (has('crown')) { g(accent, headX + 1, headY - 2, headW - 2, 2); g(accent, headX + 1, headY - 4, 1, 2); g(accent, headX + Math.floor(headW / 2), headY - 4, 1, 2); g(accent, headX + headW - 2, headY - 4, 1, 2); }
  if (has('hood')) { g(dark, headX - 1, headY - 1, headW + 2, 4); g(dark, headX - 1, headY + 3, 2, 5); g(dark, headX + headW - 1, headY + 3, 2, 5); }
  if (has('mane')) { g(accent, headX + headW, headY - 1, 3, 9); g(accent, headX + headW - 1, headY - 2, 3, 2); }
  if (has('tusks')) { g(white, headX - 1, headY + 6, 2, 3); g(white, headX + 3, headY + 6, 2, 3); }
  if (has('fangs')) { g(white, headX + 1, headY + headW - 1, 1, 2); g(white, headX + 3, headY + headW - 1, 1, 2); }
  if (has('tentacles')) { for (let i = 0; i < 4; i++) { g(dark, headX + 1 + i * 2, headY + 7, 1, 4 + (i % 2) * 2); g(accent, headX + 1 + i * 2, headY + 11 + (i % 2) * 2, 1, 1); } }
  if (has('spikes')) { for (let i = 0; i < 5; i++) g(accent, 6 + i * 4, spec.body === 'quadruped' ? 9 : 10 - (i % 2), 1, 2); }
  if (has('shell')) { g(dark, 6, 7, 17, 6); g(accent, 9, 8, 3, 2); g(accent, 15, 9, 3, 2); }
  if (has('fins')) { g(accent, 11, 0, 6, 4); g(accent, 3, 14, 3, 4); g(accent, 22, 14, 3, 4); }
  if (has('tail')) {
    if (spec.body === 'quadruped') { g(main, 22, 8, 3, 4); g(main, 24, 5, 3, 4); g(accent, 26, 3, 2, 3); }
    else if (spec.body === 'flyer') { g(main, 18, 19, 4, 3); g(main, 21, 21, 4, 3); g(accent, 24, 23, 3, 2); }
    else { g(main, 20, 19, 4, 3); g(main, 23, 21, 3, 3); g(accent, 25, 24, 2, 2); }
  }
  if (has('claws')) { g(white, 6, 27, 1, 1); g(white, 8, 27, 1, 1); g(white, 20, 27, 1, 1); g(white, 22, 27, 1, 1); }
  if (has('weapon')) { g(dark, 22, 6, 1, 14); g(white, 21, 3, 3, 5); g(accent, 20, 8, 5, 1); }
  if (has('staff')) { g(dark, 22, 4, 1, 18); g(accent, 20, 2, 5, 3); g(white, 22, 3, 1, 1); }
  if (has('bow')) { g(dark, 3, 8, 1, 12); g(accent, 2, 9, 1, 10); g(dark, 4, 13, 4, 1); }
  if (has('shield')) { g(accent, 3, 12, 5, 7); g(dark, 4, 13, 3, 5); }
  if (has('chains')) { for (let i = 0; i < 4; i++) g(white, 5 + i * 3, 21 + (i % 2), 2, 1); for (let i = 0; i < 3; i++) g(white, 19 + i * 3, 22 - (i % 2), 2, 1); }
  if (has('flames')) { const f = flash || '#ff9a3c', f2 = flash || '#ffe08a'; g(f, 8, 0, 2, 3); g(f2, 9, 1, 1, 1); g(f, 17, 1, 2, 3); g(f2, 18, 2, 1, 1); g(f, 13, 0, 2, 2); }
  if (has('frost')) { const f = flash || '#cfefff'; g(f, 6, 2, 1, 3); g(f, 21, 3, 1, 3); g(f, 13, 0, 1, 2); g(f, 3, 24, 2, 1); g(f, 23, 25, 2, 1); }
  if (has('glow')) { g(eye, headX + 1, headY + 3, 3, 2); g(eye, headX + headW - 4, headY + 3, 3, 2); g(accent, 13, 27, 3, 1); }
}
