/**
 * WeatherSystem — dynamic overworld weather that affects the game world.
 * Weather changes every few minutes, with visual effects and mechanical
 * impacts on combat and exploration.
 */

export type WeatherType =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'heavy_rain'
  | 'fog'
  | 'snow'
  | 'sandstorm'
  | 'magical_aurora'
  | 'eerie_mist'
  | 'blood_red_sky';

export interface WeatherState {
  type: WeatherType;
  /** Remaining duration in game ticks. */
  ticksLeft: number;
  /** Visibility modifier (0-1, lower = harder to see). */
  visibility: number;
  /** Combat modifier: attack bonus/penalty for ranged attacks. */
  rangedModifier: number;
  /** Movement cost multiplier (1 = normal, 1.5 = harder terrain). */
  moveCostMultiplier: number;
  /** Flavor text for the current weather. */
  description: string;
  /** Icon for display. */
  icon: string;
}

interface WeatherDef {
  type: WeatherType;
  minDuration: number;
  maxDuration: number;
  visibility: number;
  rangedModifier: number;
  moveCostMultiplier: number;
  icon: string;
  descriptions: string[];
  /** Minimum dungeon/overworld level for this weather. */
  minLevel: number;
}

const WEATHER_DEFS: WeatherDef[] = [
  {
    type: 'clear',
    minDuration: 30, maxDuration: 120,
    visibility: 1.0, rangedModifier: 0, moveCostMultiplier: 1.0,
    icon: '\u2600\ufe0f',
    descriptions: [
      'The sky is clear and bright. A perfect day for adventuring.',
      'Sunshine bathes the land. Birds sing in the treetops.',
      'A warm breeze carries the scent of wildflowers.',
    ],
    minLevel: 0,
  },
  {
    type: 'cloudy',
    minDuration: 20, maxDuration: 80,
    visibility: 0.9, rangedModifier: 0, moveCostMultiplier: 1.0,
    icon: '\u2601\ufe0f',
    descriptions: [
      'Grey clouds gather overhead, dimming the light.',
      'Overcast skies stretch from horizon to horizon.',
      'Thick clouds obscure the sun. Shadows grow long.',
    ],
    minLevel: 0,
  },
  {
    type: 'rain',
    minDuration: 15, maxDuration: 60,
    visibility: 0.7, rangedModifier: -1, moveCostMultiplier: 1.1,
    icon: '\ud83c\udf27\ufe0f',
    descriptions: [
      'Rain begins to fall, drumming on armor and shields.',
      'A steady rain soaks the party. Mud squelches underfoot.',
      'Cold rain drives sideways on the wind. Visibility drops.',
    ],
    minLevel: 0,
  },
  {
    type: 'heavy_rain',
    minDuration: 10, maxDuration: 30,
    visibility: 0.5, rangedModifier: -2, moveCostMultiplier: 1.3,
    icon: '\u26c8\ufe0f',
    descriptions: [
      'A torrential downpour! Lightning splits the sky. Thunder shakes the earth.',
      'Sheets of rain turn the road to a river. Ranged weapons are nearly useless.',
      'The storm howls. Rain lashes like needles. The party can barely see.',
    ],
    minLevel: 0,
  },
  {
    type: 'fog',
    minDuration: 20, maxDuration: 60,
    visibility: 0.4, rangedModifier: -2, moveCostMultiplier: 1.0,
    icon: '\ud83c\udf2b\ufe0f',
    descriptions: [
      'A thick fog rolls in, reducing everything to ghostly shapes.',
      'Mist clings to the ground like a living thing. Sounds are muffled.',
      'The fog is so dense the party can barely see their own feet.',
    ],
    minLevel: 0,
  },
  {
    type: 'snow',
    minDuration: 20, maxDuration: 80,
    visibility: 0.6, rangedModifier: -1, moveCostMultiplier: 1.2,
    icon: '\u2744\ufe0f',
    descriptions: [
      'Snowflakes drift down, dusting the world in white.',
      'A blizzard threatens on the horizon. The cold bites through armor.',
      'Heavy snow falls. The party leaves deep tracks in the powder.',
    ],
    minLevel: 0,
  },
  {
    type: 'sandstorm',
    minDuration: 10, maxDuration: 40,
    visibility: 0.3, rangedModifier: -3, moveCostMultiplier: 1.5,
    icon: '\ud83c\udf35',
    descriptions: [
      'A sandstorm batters the party! Sand grinds between teeth and clogs nostrils.',
      'The desert wind rises to a scream. Visibility drops to near zero.',
      'Stinging sand clouds blur the horizon. Every exposed surface is scoured raw.',
    ],
    minLevel: 2,
  },
  {
    type: 'magical_aurora',
    minDuration: 15, maxDuration: 40,
    visibility: 1.0, rangedModifier: 0, moveCostMultiplier: 1.0,
    icon: '\ud83c\udf08',
    descriptions: [
      'Arcane lights dance across the sky in swirling ribbons of color.',
      'The aurora crackles with wild magic. Spellcasters feel their power surge.',
      'The sky blazes with unearthly colors. The air itself hums with energy.',
    ],
    minLevel: 3,
  },
  {
    type: 'eerie_mist',
    minDuration: 10, maxDuration: 30,
    visibility: 0.5, rangedModifier: -1, moveCostMultiplier: 1.0,
    icon: '\ud83d\udc7b',
    descriptions: [
      'A cold, unnatural mist creeps along the ground. Whispers seem to come from everywhere.',
      'The mist is thick and green-tinged. The party feels watched from every direction.',
      'Ghostly shapes flicker at the edges of vision. The mist carries a scent of old death.',
    ],
    minLevel: 2,
  },
  {
    type: 'blood_red_sky',
    minDuration: 8, maxDuration: 20,
    visibility: 0.8, rangedModifier: 0, moveCostMultiplier: 1.0,
    icon: '\ud83d\udd25',
    descriptions: [
      'The sky turns a deep, ominous red. Something ancient stirs.',
      'The heavens burn crimson. All beasts grow restless. A boss fight looms.',
      'Blood-red clouds swirl overhead. The air tastes of iron and dread.',
    ],
    minLevel: 4,
  },
];

/** Roll new weather based on location level and previous weather. */
export function rollWeather(level: number, current: WeatherState | null): WeatherState {
  const available = WEATHER_DEFS.filter(w => w.minLevel <= level);
  // 40% chance to keep current weather
  if (current && Math.random() < 0.4) {
    return { ...current, ticksLeft: current.ticksLeft + 20 };
  }
  const def = available[Math.floor(Math.random() * available.length)];
  const duration = def.minDuration + Math.floor(Math.random() * (def.maxDuration - def.minDuration));
  return {
    type: def.type,
    ticksLeft: duration,
    visibility: def.visibility,
    rangedModifier: def.rangedModifier,
    moveCostMultiplier: def.moveCostMultiplier,
    description: def.descriptions[Math.floor(Math.random() * def.descriptions.length)],
    icon: def.icon,
  };
}

/** Tick the weather down. Returns new state or null if weather expired. */
export function tickWeather(state: WeatherState): WeatherState | null {
  const remaining = state.ticksLeft - 1;
  if (remaining <= 0) return null;
  return { ...state, ticksLeft: remaining };
}

/** Get a weather display string for the HUD. */
export function weatherDisplay(state: WeatherState): string {
  return `${state.icon} ${state.type.replace(/_/g, ' ')} (${state.ticksLeft})`;
}
