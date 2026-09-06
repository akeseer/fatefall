/**
 * The battlefield's backdrop, chosen from where the fight is.
 *
 * The battle window used to stand every fight on the same dark floor under
 * the same gold horizon. This turns the place the party is actually standing
 * into CSS: the sky's colour from the hour and the weather, the floor from
 * the ground underfoot, and a layer of scenery behind the ranks (pillars in a
 * hall, trunks in a forest, peaks, dunes, stalactites, embers) drawn with
 * gradients so it costs no images and scales with the window.
 *
 * Everything here is pure: a scene in, a handful of CSS strings out, which
 * the battle view assigns to custom properties on its ground layers.
 */

import { themeLight } from '../rendering/ThemeLight';

export interface BattleScene {
  place: 'dungeon' | 'overworld' | 'town';
  /** Dungeon theme id, underground. */
  themeId?: string | null;
  /** Overworld region biome, on the surface. */
  biome?: string | null;
  weather?: string | null;
  /** 0 midnight .. 1 noon. */
  daylight: number;
}

export interface BattleSceneCss {
  /** The band above the horizon. */
  sky: string;
  /** The floor the ranks stand on. */
  floor: string;
  /** The horizon hairline's colour. */
  horizon: string;
  /** The faint courses drawn across the floor, and the glow under the ranks. */
  lines: string;
  glow: string;
  /** Silhouettes behind the ranks. Empty for an open plain. */
  scenery: string;
  /** A wash over everything: rain, fog, the dark. Empty when the air is clear. */
  weather: string;
}

type Motif = 'pillars' | 'cave' | 'roots' | 'embers' | 'mist' | 'stars' | 'water';

/** Which scenery a dungeon theme calls for. Unknown themes get the plain hall. */
const THEME_MOTIF: Record<string, Motif> = {
  ancient_dwarven_hall: 'pillars',
  royal_crypt: 'pillars',
  thieves_guild_den: 'pillars',
  vampire_castle: 'pillars',
  wizards_tower_lore_loc: 'pillars',
  sunken_temple: 'water',
  celestial_observatory: 'stars',
  goblin_warren: 'cave',
  dragon_graveyard: 'cave',
  illithid_colony: 'cave',
  feywild_glade: 'roots',
  abyssal_rift: 'embers',
  elemental_node_fire: 'embers',
  shadowfell_crossing: 'mist',
  salt_mine_deeps: 'cave',
  drowned_lighthouse: 'water',
  plague_hospice: 'pillars',
  giants_causeway: 'stars',
};

function rgb(c: [number, number, number], scale = 1, alpha?: number): string {
  const r = Math.round(Math.min(255, c[0] * 255 * scale));
  const g = Math.round(Math.min(255, c[1] * 255 * scale));
  const b = Math.round(Math.min(255, c[2] * 255 * scale));
  return alpha === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ── Scenery ──

function pillars(shade: string, light: string): string {
  // Four columns across the back wall, each shaded from its lit edge to its dark one.
  const cols = [7, 31, 65, 90];
  return cols.map(x =>
    `linear-gradient(90deg, transparent calc(${x}% - 22px), ${shade} calc(${x}% - 20px), ${light} calc(${x}% - 6px), ${shade} calc(${x}% + 14px), transparent calc(${x}% + 16px)) top / 100% 62% no-repeat`,
  ).join(', ');
}

function cave(shade: string): string {
  // Stalactites: ellipses hanging from the top edge, and a low rubble band.
  const drops = [4, 15, 27, 43, 58, 71, 84, 95].map((x, i) =>
    `radial-gradient(ellipse ${18 + (i % 3) * 8}px ${70 + (i % 4) * 34}px at ${x}% -6%, ${shade} 68%, transparent 72%)`,
  );
  return drops.join(', ');
}

function roots(shade: string, canopy: string): string {
  // Great trunks with a canopy lost in the dark above.
  const trunks = [9, 27, 49, 73, 91].map((x, i) =>
    `linear-gradient(90deg, transparent calc(${x}% - ${9 + i % 2 * 3}px), ${shade} calc(${x}% - ${7 + i % 2 * 3}px), ${shade} calc(${x}% + ${7 + i % 2 * 3}px), transparent calc(${x}% + ${9 + i % 2 * 3}px)) top / 100% 70% no-repeat`,
  );
  return [`radial-gradient(ellipse 120% 40% at 50% -10%, ${canopy} 45%, transparent 75%)`, ...trunks].join(', ');
}

function embers(glow: string, deep: string): string {
  // A vent's light from below, and a scatter of embers rising through the dark.
  const sparks = [6, 19, 33, 47, 61, 76, 88, 95].map((x, i) =>
    `radial-gradient(circle 2px at ${x}% ${30 + ((i * 17) % 55)}%, ${glow} 90%, transparent 100%)`,
  );
  return [`radial-gradient(ellipse 80% 40% at 50% 105%, ${deep} 0%, transparent 70%)`, ...sparks].join(', ');
}

function mist(shade: string): string {
  return `radial-gradient(ellipse 60% 30% at 20% 70%, ${shade} 0%, transparent 70%), radial-gradient(ellipse 70% 30% at 75% 60%, ${shade} 0%, transparent 70%)`;
}

function stars(light: string): string {
  const pts = [3, 11, 18, 26, 37, 44, 52, 63, 70, 79, 87, 96].map((x, i) =>
    `radial-gradient(circle 1.2px at ${x}% ${4 + ((i * 23) % 30)}%, ${light} 90%, transparent 100%)`,
  );
  return pts.join(', ');
}

function water(light: string): string {
  // Standing water: a reflective band across the floor with slow ripples.
  return `repeating-linear-gradient(180deg, transparent 0 18px, ${light} 18px 19px) 0 45% / 100% 55% no-repeat, radial-gradient(ellipse 60% 20% at 50% 70%, ${light} 0%, transparent 70%)`;
}

function trees(shade: string): string {
  // A forest edge: irregular crowns (two lobes per tree at different heights)
  // on trunks that run down to the horizon, in two depths so it reads as a
  // wood rather than a row of balloons.
  const xs = [4, 15, 27, 41, 56, 68, 81, 94];
  const layers: string[] = [];
  xs.forEach((x, i) => {
    const h = 44 + (i % 3) * 10;
    layers.push(`radial-gradient(ellipse 34px 52px at ${x - 2}% ${h}%, ${shade} 62%, transparent 66%)`);
    layers.push(`radial-gradient(ellipse 28px 40px at ${x + 3}% ${h - 12}%, ${shade} 62%, transparent 66%)`);
    layers.push(`linear-gradient(90deg, transparent calc(${x}% - 5px), ${shade} calc(${x}% - 4px), ${shade} calc(${x}% + 4px), transparent calc(${x}% + 5px)) 0 100% / 100% ${100 - h + 20}% no-repeat`);
  });
  // A darker understorey band where the trunks meet the ground.
  layers.push(`linear-gradient(180deg, transparent 80%, ${shade} 100%)`);
  return layers.join(', ');
}

function peaks(shade: string, far: string): string {
  // Two ranges of rounded summits, the farther paler.
  const farRange = [10, 35, 60, 85].map(x => `radial-gradient(ellipse 220px 160px at ${x}% 78%, ${far} 60%, transparent 62%)`);
  const near = [0, 28, 55, 80, 100].map(x => `radial-gradient(ellipse 160px 130px at ${x}% 96%, ${shade} 60%, transparent 62%)`);
  return [...farRange, ...near].join(', ');
}

function dunes(shade: string, lit: string): string {
  return [
    `radial-gradient(ellipse 60% 26% at 30% 88%, ${lit} 0%, transparent 70%)`,
    `radial-gradient(ellipse 340px 90px at 20% 100%, ${shade} 60%, transparent 62%)`,
    `radial-gradient(ellipse 420px 110px at 75% 104%, ${shade} 60%, transparent 62%)`,
  ].join(', ');
}

function reeds(shade: string): string {
  const stalks = [4, 9, 14, 21, 27, 33, 66, 72, 78, 84, 90, 96].map((x, i) =>
    `linear-gradient(90deg, transparent calc(${x}% - 1px), ${shade} calc(${x}% - 0.5px), ${shade} calc(${x}% + 0.5px), transparent calc(${x}% + 1px)) 0 ${40 + (i % 3) * 8}% / 100% 60% no-repeat`,
  );
  return stalks.join(', ');
}

function roofs(shade: string, lamp: string): string {
  // Town: gables against the sky and a lamp's glow.
  const gables = [8, 30, 52, 74, 94].map((x, i) => `radial-gradient(ellipse 90px ${70 + (i % 2) * 30}px at ${x}% 80%, ${shade} 60%, transparent 62%)`);
  return [`radial-gradient(circle 40px at 62% 52%, ${lamp} 0%, transparent 80%)`, ...gables].join(', ');
}

// ── Weather over everything ──

function weatherWash(weather: string | null | undefined, night: number): string {
  const layers: string[] = [];
  switch (weather) {
    case 'rain':
      layers.push('repeating-linear-gradient(112deg, transparent 0 14px, rgba(190,210,235,0.10) 14px 15px)');
      break;
    case 'heavy_rain':
      layers.push('repeating-linear-gradient(110deg, transparent 0 9px, rgba(190,210,235,0.16) 9px 10px)', 'linear-gradient(180deg, rgba(20,30,50,0.25), transparent 40%)');
      break;
    case 'snow':
      layers.push('radial-gradient(circle 1.5px at 12% 20%, #fff 90%, transparent), radial-gradient(circle 1.5px at 33% 61%, #fff 90%, transparent), radial-gradient(circle 1.5px at 58% 35%, #fff 90%, transparent), radial-gradient(circle 1.5px at 81% 72%, #fff 90%, transparent), radial-gradient(circle 1.5px at 92% 15%, #fff 90%, transparent)', 'linear-gradient(180deg, rgba(225,230,245,0.10), transparent 60%)');
      break;
    case 'fog':
    case 'eerie_mist':
      layers.push(`radial-gradient(ellipse 80% 50% at 50% 60%, rgba(${weather === 'fog' ? '185,194,204' : '111,143,122'},0.28), transparent 75%)`);
      break;
    case 'sandstorm':
      layers.push('repeating-linear-gradient(95deg, transparent 0 22px, rgba(192,154,82,0.14) 22px 24px)', 'linear-gradient(180deg, rgba(192,154,82,0.22), rgba(120,90,40,0.12))');
      break;
    case 'blood_red_sky':
      layers.push('linear-gradient(180deg, rgba(142,31,34,0.28), transparent 45%)');
      break;
  }
  if (night > 0.02) layers.push(`linear-gradient(180deg, rgba(4,6,16,${(0.55 * night).toFixed(3)}), rgba(4,6,16,${(0.35 * night).toFixed(3)}))`);
  return layers.join(', ');
}

// ── The scenes ──

export function battleSceneCss(scene: BattleScene): BattleSceneCss {
  if (scene.place === 'dungeon') return dungeonScene(scene.themeId ?? null);
  if (scene.place === 'town') return townScene(scene.daylight, scene.weather);
  return surfaceScene(scene.biome ?? 'grassland', scene.daylight, scene.weather);
}

function dungeonScene(themeId: string | null): BattleSceneCss {
  const light = themeLight(themeId);
  const motif: Motif = (themeId && THEME_MOTIF[themeId]) || 'pillars';
  const stone: [number, number, number] = [0.16, 0.13, 0.11];
  const tinted = mix(stone, light, 0.18);
  const wall = rgb(tinted, 0.75);
  const wallLit = rgb(mix(tinted, light, 0.25), 1.05);
  const floorHi = rgb(mix([0.17, 0.14, 0.12], light, 0.12));
  const floorLo = rgb([0.07, 0.06, 0.06]);
  const horizon = rgb(light, 1, 0.55);
  const glow = rgb(light, 1, 0.16);
  let scenery = '';
  switch (motif) {
    case 'pillars': scenery = pillars(wall, wallLit); break;
    case 'cave': scenery = cave(rgb(tinted, 0.6)); break;
    case 'roots': scenery = roots(rgb([0.09, 0.12, 0.08]), rgb(mix([0.05, 0.1, 0.06], light, 0.2))); break;
    case 'embers': scenery = embers(rgb(light, 1, 0.9), rgb(light, 0.7, 0.35)); break;
    case 'mist': scenery = mist(rgb(light, 0.6, 0.18)); break;
    case 'stars': scenery = stars(rgb(light, 1.2, 0.9)); break;
    case 'water': scenery = water(rgb(light, 1, 0.14)); break;
  }
  return {
    sky: `linear-gradient(180deg, #05040a 0%, ${rgb(tinted, 0.45)} 100%)`,
    floor: `linear-gradient(180deg, ${floorHi} 0%, ${rgb(mix([0.14, 0.11, 0.09], light, 0.08))} 55%, ${floorLo} 100%)`,
    horizon,
    lines: rgb(light, 1, 0.05),
    glow,
    scenery,
    weather: '',
  };
}

function surfaceScene(biome: string, daylight: number, weather: string | null | undefined): BattleSceneCss {
  const night = Math.max(0, 1 - daylight);
  const dusk = daylight > 0.25 && daylight < 0.6 ? 1 - Math.abs(daylight - 0.42) / 0.18 : 0;
  // Sky: blue by day, amber at the turn, near-black with a blue cast at night.
  const daySky: [number, number, number] = biome === 'desert' ? [0.66, 0.74, 0.86] : biome === 'snow' ? [0.72, 0.78, 0.88] : [0.45, 0.62, 0.85];
  const nightSky: [number, number, number] = [0.04, 0.05, 0.12];
  let skyTop = mix(nightSky, daySky, daylight);
  let skyBot = mix(nightSky, mix(daySky, [1, 1, 1], 0.35), daylight);
  if (dusk > 0) skyBot = mix(skyBot, [0.95, 0.55, 0.3], dusk * 0.6);
  if (weather === 'rain' || weather === 'heavy_rain' || weather === 'cloudy') { skyTop = mix(skyTop, [0.3, 0.33, 0.38], 0.6); skyBot = mix(skyBot, [0.42, 0.45, 0.5], 0.6); }
  if (weather === 'blood_red_sky') { skyTop = mix(skyTop, [0.45, 0.08, 0.1], 0.6); skyBot = mix(skyBot, [0.6, 0.2, 0.15], 0.6); }

  const ground: Record<string, { hi: [number, number, number]; lo: [number, number, number]; line: string; scenery: (n: number) => string }> = {
    grassland: { hi: [0.26, 0.38, 0.19], lo: [0.12, 0.18, 0.09], line: 'rgba(120,160,80,0.10)', scenery: () => `radial-gradient(ellipse 70% 30% at 50% 90%, rgba(60,90,40,0.35), transparent 70%)` },
    forest: { hi: [0.2, 0.3, 0.15], lo: [0.08, 0.13, 0.07], line: 'rgba(110,150,80,0.08)', scenery: (n) => trees(`rgba(${Math.round(18 - 8 * n)},${Math.round(34 - 14 * n)},${Math.round(16 - 6 * n)},0.95)`) },
    mountain: { hi: [0.34, 0.33, 0.35], lo: [0.15, 0.14, 0.16], line: 'rgba(200,200,215,0.08)', scenery: (n) => peaks(`rgba(${Math.round(48 - 20 * n)},${Math.round(46 - 20 * n)},${Math.round(56 - 20 * n)},0.95)`, `rgba(${Math.round(80 - 40 * n)},${Math.round(82 - 40 * n)},${Math.round(96 - 40 * n)},0.6)`) },
    swamp: { hi: [0.2, 0.26, 0.16], lo: [0.08, 0.1, 0.07], line: 'rgba(120,150,90,0.08)', scenery: (n) => `${reeds(`rgba(${Math.round(30 - 12 * n)},${Math.round(44 - 16 * n)},${Math.round(24 - 8 * n)},0.9)`)}, ${mist('rgba(120,150,110,0.18)')}` },
    desert: { hi: [0.72, 0.6, 0.38], lo: [0.42, 0.33, 0.2], line: 'rgba(255,230,170,0.10)', scenery: (n) => dunes(`rgba(${Math.round(150 - 70 * n)},${Math.round(120 - 60 * n)},${Math.round(70 - 35 * n)},0.9)`, `rgba(255,220,150,${(0.18 * (1 - n)).toFixed(2)})`) },
    snow: { hi: [0.82, 0.86, 0.92], lo: [0.5, 0.56, 0.66], line: 'rgba(255,255,255,0.14)', scenery: (n) => peaks(`rgba(${Math.round(150 - 80 * n)},${Math.round(160 - 80 * n)},${Math.round(180 - 80 * n)},0.9)`, `rgba(${Math.round(200 - 90 * n)},${Math.round(206 - 90 * n)},${Math.round(220 - 90 * n)},0.6)`) },
    coast: { hi: [0.62, 0.56, 0.42], lo: [0.3, 0.28, 0.22], line: 'rgba(120,170,200,0.12)', scenery: (n) => `linear-gradient(180deg, transparent 58%, rgba(${Math.round(40 - 20 * n)},${Math.round(90 - 40 * n)},${Math.round(130 - 50 * n)},0.85) 60%, rgba(${Math.round(30 - 15 * n)},${Math.round(70 - 30 * n)},${Math.round(110 - 40 * n)},0.9) 76%, transparent 78%)` },
  };
  const g = ground[biome] ?? ground.grassland;
  const shade = 0.35 + 0.65 * daylight;
  return {
    sky: `linear-gradient(180deg, ${rgb(skyTop)} 0%, ${rgb(skyBot)} 100%)`,
    floor: `linear-gradient(180deg, ${rgb(g.hi, shade)} 0%, ${rgb(mix(g.hi, g.lo, 0.5), shade)} 50%, ${rgb(g.lo, shade)} 100%)`,
    horizon: night > 0.6 ? 'rgba(160,180,230,0.35)' : 'rgba(255,240,200,0.45)',
    lines: g.line,
    glow: night > 0.6 ? 'rgba(180,200,255,0.10)' : 'rgba(255,240,200,0.12)',
    scenery: g.scenery(night),
    weather: weatherWash(weather, night),
  };
}

function townScene(daylight: number, weather: string | null | undefined): BattleSceneCss {
  const night = Math.max(0, 1 - daylight);
  const skyTop = mix([0.04, 0.05, 0.12], [0.5, 0.62, 0.8], daylight);
  const skyBot = mix([0.08, 0.07, 0.1], [0.85, 0.8, 0.7], daylight);
  return {
    sky: `linear-gradient(180deg, ${rgb(skyTop)} 0%, ${rgb(skyBot)} 100%)`,
    floor: `linear-gradient(180deg, ${rgb([0.3, 0.27, 0.25], 0.4 + 0.6 * daylight)} 0%, ${rgb([0.16, 0.14, 0.13], 0.5 + 0.5 * daylight)} 100%)`,
    horizon: 'rgba(255,220,150,0.45)',
    lines: 'rgba(255,230,190,0.10)',
    glow: 'rgba(255,200,120,0.16)',
    scenery: roofs(`rgba(${Math.round(40 - 20 * night)},${Math.round(34 - 16 * night)},${Math.round(34 - 14 * night)},0.95)`, `rgba(255,190,100,${(0.25 + 0.35 * night).toFixed(2)})`),
    weather: weatherWash(weather, night),
  };
}
