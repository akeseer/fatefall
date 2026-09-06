/**
 * The colour of the light in each kind of dungeon.
 *
 * Every dungeon theme already has a palette with a `glow` — the colour of
 * its runes, its crystals, its embers — that the map renderer uses for the
 * dressing. The party's own light is composited on top by the backends, and
 * until now it was the same warm flame everywhere. This is that glow, made
 * available to the lighting and the dust so the light of a place agrees with
 * the place: an ember red in the dragon graveyard, teal in the sunken temple,
 * violet in the feywild.
 *
 * Backend-neutral on purpose. The Pixi lighting, the Pixi ambience and the
 * Canvas fallback all read it, so it must not live under either backend.
 */

/** The theme glows, as 0..1 channels. Kept in step with THEME_PALETTES by hand; a miss falls back to flame. */
const THEME_LIGHT: Record<string, [number, number, number]> = {
  ancient_dwarven_hall: [1.0, 0.71, 0.29],
  feywild_glade: [0.88, 0.63, 1.0],
  shadowfell_crossing: [0.54, 0.69, 0.91],
  thieves_guild_den: [1.0, 0.82, 0.48],
  dragon_graveyard: [1.0, 0.6, 0.29],
  illithid_colony: [0.75, 0.63, 1.0],
  sunken_temple: [0.48, 1.0, 0.83],
  wizards_tower_lore_loc: [0.71, 0.54, 1.0],
  goblin_warren: [0.83, 0.75, 0.35],
  royal_crypt: [1.0, 0.88, 0.54],
  abyssal_rift: [1.0, 0.38, 0.25],
  elemental_node_fire: [1.0, 0.69, 0.38],
  vampire_castle: [1.0, 0.48, 0.6],
  celestial_observatory: [0.6, 0.75, 1.0],
  salt_mine_deeps: [1.0, 0.95, 0.85],
  drowned_lighthouse: [0.55, 0.85, 1.0],
  plague_hospice: [0.85, 0.9, 0.6],
  giants_causeway: [0.8, 0.85, 1.0],
  clockwork_foundry: [1.0, 0.72, 0.4],
  jungle_ziggurat: [0.7, 1.0, 0.55],
  frozen_necropolis: [0.65, 0.85, 1.0],
  sky_citadel: [0.85, 0.92, 1.0],
  fungal_grotto: [0.7, 0.6, 1.0],
  pirate_cove: [0.6, 0.85, 0.9],
  astral_wreck: [0.85, 0.85, 1.0],
  desert_tomb: [1.0, 0.85, 0.5],
  haunted_theatre: [1.0, 0.55, 0.55],
  dream_labyrinth: [0.9, 0.7, 1.0],
};

/** Plain flame, for the surface and for any theme not in the table. */
export const FLAME_LIGHT: [number, number, number] = [1.0, 0.94, 0.82];

/**
 * How far the light leans toward the theme. All the way would tint a warm
 * baked torch by a cold hue and come out muddy; this far keeps it bright and
 * reads as the place colouring the light rather than replacing it. It sits
 * under a colour grade that already cools every dungeon toward blue, which
 * is why it leans further than it looks like it should need to.
 */
const THEME_LEAN = 0.72;

/** The light of a theme, or plain flame, as 0..1 channels. */
export function themeLight(themeId: string | null | undefined): [number, number, number] {
  const glow = themeId ? THEME_LIGHT[themeId] : undefined;
  if (!glow) return FLAME_LIGHT;
  return [
    FLAME_LIGHT[0] + (glow[0] - FLAME_LIGHT[0]) * THEME_LEAN,
    FLAME_LIGHT[1] + (glow[1] - FLAME_LIGHT[1]) * THEME_LEAN,
    FLAME_LIGHT[2] + (glow[2] - FLAME_LIGHT[2]) * THEME_LEAN,
  ];
}

/** The same, packed as 0xRRGGBB for a Pixi tint or a canvas colour. */
export function themeLightHex(themeId: string | null | undefined): number {
  const [r, g, b] = themeLight(themeId);
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
