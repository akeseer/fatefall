"""
Build the hundred pre-built dungeons.

Every dungeon here is fixed: its floors' layouts, every monster's position,
and the boss in its hall are decided once, by this script, and written to
src/data/PrebuiltDungeons.ts. The game reads that file; it never rolls a
layout for a pre-built delve. Re-run the script (npm run build-dungeons) to
regenerate the data after changing the bestiary, the themes, or the styles
below. The seed is the dungeon's index, so a rebuild reproduces the same
hundred unless the inputs changed.

Monster rosters and challenge ratings are read out of the TypeScript
sources with regular expressions, so the data always names creatures the
bestiary knows.
"""

import io
import os
import random
import re
from collections import deque

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(SRC, 'data', 'PrebuiltDungeons.ts')

MAP_W, MAP_H = 72, 72

# ── Read the bestiary ─────────────────────────────────────────────────────

def read(path):
    return io.open(os.path.join(SRC, path), encoding='utf-8').read()

monster_src = read('entities/Monster.ts')
expansion_src = read('entities/MonsterExpansion.ts')
menagerie_src = read('entities/MonsterMenagerie.ts')

CR = {}      # id -> cr
KIND = {}    # id -> type
for m in re.finditer(r"id: '(\w+)',[\s\S]*?xp: \d+, cr: ([\d.]+), size: '\w+', type: '(\w+)'", monster_src):
    CR[m.group(1)] = float(m.group(2)); KIND[m.group(1)] = m.group(3)
helper = re.compile(r"m\('(\w+)', '(?:[^'\\]|\\.)*', '(?:[^'\\]|\\.)*', ([\d.]+), '(\w+)'")
for src in (expansion_src, menagerie_src):
    for m in helper.finditer(src):
        CR[m.group(1)] = float(m.group(2)); KIND[m.group(1)] = m.group(3)

unseeable = set()
u = monster_src.find('isUnseeableMonster')
if u >= 0:
    unseeable = set(re.findall(r"'(\w+)'", monster_src[u:u + 1500]))

THEMES = {}
def read_themes(src, const):
    i = src.find(const)
    if i < 0:
        return
    j = src.find('\n};', i)
    block = src[i:j]
    for m in re.finditer(r"(\w+): \[([^\]]*)\]", block):
        ids = re.findall(r"'(\w+)'", m.group(2))
        THEMES.setdefault(m.group(1), [])
        THEMES[m.group(1)].extend(i for i in ids if i in CR)
read_themes(monster_src, 'export const THEME_MONSTERS')
read_themes(expansion_src, 'export const EXPANSION_THEMES')
read_themes(menagerie_src, 'export const MENAGERIE_THEMES')
for k in THEMES:
    seen = []
    for i in THEMES[k]:
        if i not in seen and i not in unseeable:
            seen.append(i)
    THEMES[k] = seen

knowledge = read('ai/DnDKnowledge.ts')
loc_block = knowledge[knowledge.find('export const LOCATIONS'):]
LOCATION_IDS = re.findall(r"^    id: '(\w+)', name: '((?:[^'\\]|\\.)*)', category: '(\w+)'", loc_block, re.M)
LOCATION_IDS = [(i, n, c) for i, n, c in LOCATION_IDS]

GENERIC = sorted(i for i in CR if i not in unseeable)

def pool(theme, max_cr, min_cr=0.0):
    themed = [i for i in THEMES.get(theme, []) if min_cr <= CR[i] <= max_cr]
    if len(themed) >= 3:
        return themed
    return themed + [i for i in GENERIC if min_cr <= CR[i] <= max_cr]

# ── Names and words ───────────────────────────────────────────────────────

FIRST = ['Hollow', 'Barrow', 'Wyrm', 'Gloom', 'Ash', 'Cinder', 'Salt', 'Raven', 'Thorn', 'Bone', 'Murk', 'Ember', 'Frost',
         'Shadow', 'Iron', 'Silver', 'Black', 'Grey', 'Sorrow', 'Widow', 'King', 'Saint', 'Bell', 'Lantern', 'Glass', 'Blood',
         'Star', 'Storm', 'Mire', 'Crow', 'Nightjar', 'Copper', 'Rime', 'Dusk', 'Moth', 'Wolf', 'Serpent', 'Vesper', 'Harrow', 'Old']
SECOND = ['moor', 'fang', 'hollow', 'well', 'gate', 'crown', 'fen', 'deep', 'mere', 'spire', 'watch', 'reach', 'vault', 'hall',
          'stair', 'delve', 'fold', 'cross', 'hold', 'wick']
KINDS = ['Depths', 'Catacombs', 'Warrens', 'Keep', 'Crypts', 'Galleries', 'Sanctum', 'Fane', 'Oubliette', 'Undercroft',
         'Labyrinth', 'Vaults', 'Sepulchre', 'Delve', 'Maw', 'Barrow', 'Foundry', 'Hospice', 'Lighthouse', 'Ziggurat',
         'Necropolis', 'Citadel', 'Grotto', 'Cove', 'Wreck', 'Tomb', 'Playhouse', 'Dreaming', 'Pits', 'Halls']

THEME_KINDS = {
    'clockwork_foundry': ['Foundry', 'Works', 'Engine'], 'jungle_ziggurat': ['Ziggurat', 'Temple', 'Steps'],
    'frozen_necropolis': ['Necropolis', 'Sepulchre', 'Rimevault'], 'sky_citadel': ['Citadel', 'Eyrie', 'Spire'],
    'fungal_grotto': ['Grotto', 'Cap-halls', 'Sporewell'], 'pirate_cove': ['Cove', 'Hold', 'Landing'],
    'astral_wreck': ['Wreck', 'Hulk', 'Fall'], 'desert_tomb': ['Tomb', 'Vault', 'Rest'],
    'haunted_theatre': ['Playhouse', 'Theatre', 'Gallery'], 'dream_labyrinth': ['Dreaming', 'Labyrinth', 'Maze'],
    'salt_mine_deeps': ['Deeps', 'Salt-galleries', 'Adit'], 'drowned_lighthouse': ['Lighthouse', 'Lantern', 'Reach'],
    'plague_hospice': ['Hospice', 'Wards', 'Almshouse'], 'giants_causeway': ['Causeway', 'Stair', 'Steps'],
    'royal_crypt': ['Crypt', 'Sepulchre', 'Barrow'], 'goblin_warren': ['Warrens', 'Burrows', 'Holes'],
    'sunken_temple': ['Fane', 'Sanctum', 'Chapel'], 'vampire_castle': ['Castle', 'Keep', 'Court'],
    'abyssal_rift': ['Rift', 'Maw', 'Pit'], 'elemental_node_fire': ['Furnace', 'Kiln', 'Vent'],
    'ancient_dwarven_hall': ['Halls', 'Delve', 'Undercroft'], 'feywild_glade': ['Glade', 'Hollow', 'Court'],
    'shadowfell_crossing': ['Crossing', 'Gallows', 'Shade'], 'thieves_guild_den': ['Den', 'Cellars', 'Undermarket'],
    'dragon_graveyard': ['Graveyard', 'Bonefield', 'Roost'], 'illithid_colony': ['Colony', 'Hive', 'Pool'],
    'wizards_tower_lore_loc': ['Tower', 'Athenaeum', 'Spire'], 'celestial_observatory': ['Observatory', 'Orrery', 'Heights'],
}

DESCRIPTIONS = {
    'clockwork_foundry': ['brass and steam, still working, still building', 'pistons in the dark and something on the line that was not ordered'],
    'jungle_ziggurat': ['stepped stone under vine, loud with insects and drums', 'a temple the jungle ate and the old gods kept'],
    'frozen_necropolis': ['streets of ice between tombs, the dead very well kept', 'blue light through the glacier and names on every door'],
    'sky_citadel': ['ramparts over nothing and a wind with teeth', 'a fortress on a cloud, reached by a stair that ends in sky'],
    'fungal_grotto': ['caps the size of roofs and a floor that gives a little', 'spores like slow snow and something breathing under the ground'],
    'pirate_cove': ['a sea-cave of rotting hulls and unspent gold', 'tide-pool cells and a bell that rings when the water reaches it'],
    'astral_wreck': ['a silver ship fallen into the earth, its hull open to another sky', 'stars on the floor and cargo from nowhere'],
    'desert_tomb': ['a king under the sand, sealed forever and opened every generation', 'false doors, true traps, and the sand still coming in'],
    'haunted_theatre': ['a house that burned full and has performed ever since', 'footlights that follow you and applause from nowhere'],
    'dream_labyrinth': ['a place someone is dreaming, that changes when they turn over', 'corridors that are also stairs, and paintings of what happens next'],
    'salt_mine_deeps': ['white galleries that glitter and dry the mouth', 'preserved bodies in the walls and a wheel still turning'],
    'drowned_lighthouse': ['a stair that spirals down where it should spiral up', 'a lamp burning under the waterline and things swimming toward it'],
    'plague_hospice': ['wards still made up and sisters still making rounds', 'a chapel with the doors nailed and beds still warm'],
    'giants_causeway': ['steps a fathom tall climbing into cloud', 'a giant\'s hearth still warm and a throne facing the wind'],
    'royal_crypt': ['a dynasty\'s dead, and their servants, still in service', 'gilt and dust and a throne that is not empty'],
    'goblin_warren': ['reeking burrows braced with stolen timber', 'traps, spikes, warning bones and a great many goblins'],
    'sunken_temple': ['green water on mosaic floors and a scratched-out god', 'kelp-choked cloisters and bone-filled fonts'],
    'vampire_castle': ['a castle where the lamps are lit and the windows are not', 'a court kept for three centuries by a host who does not age'],
    'abyssal_rift': ['a crack in the world with the world\'s enemies coming through', 'heat, screaming, and a great deal of red'],
    'elemental_node_fire': ['a place where the stone itself burns', 'vents, magma, and things that live in both'],
    'ancient_dwarven_hall': ['pillars thicker than trees and runes on every surface', 'old stone and older grief, and forges gone cold'],
    'feywild_glade': ['silver bark, wrong colours, and time that does not keep', 'fairy rings and living bridges and laughter with no one there'],
    'shadowfell_crossing': ['a grey reflection drained of colour and hope', 'still black water and a weight on the soul'],
    'thieves_guild_den': ['tunnels, false fronts and chalk marks that mean betrayal', 'safehouses under the city and traps on every vault'],
    'dragon_graveyard': ['bones the size of ships and the things that nest in them', 'a valley where dragons go to die and kobolds go to worship'],
    'illithid_colony': ['pools of thought and tentacles in the dark', 'a hive of minds that would like to add yours'],
    'wizards_tower_lore_loc': ['a tower that goes down as far as it went up', 'golems, grimoires, and experiments that outlived the experimenter'],
    'celestial_observatory': ['an orrery under a painted sky and guardians who take it seriously', 'star-charts, brass, and light that judges'],
}

STYLE_LINES = {
    'warren': 'a knot of chambers and crooked passages',
    'cavern': 'water-carved caves that open and close without warning',
    'temple': 'symmetrical halls built to a plan, and a plan built to a god',
    'gauntlet': 'a single long way down, with no way round anything',
    'ring': 'chambers set in a ring about a great central hall',
    'catacomb': 'a grid of cells and ossuaries, every one occupied',
    'lair': 'one great chamber with everything else leading to it',
    'flooded': 'halls half-drowned, the way through a matter of wading',
}

# ── Layouts ───────────────────────────────────────────────────────────────

VOID, FLOOR, WALL, DOOR, STAIRS, WATER, LAVA = ' ', '.', '#', '+', '>', '~', 'L'

class Floor:
    def __init__(self):
        self.g = [[VOID] * MAP_W for _ in range(MAP_H)]
        self.rooms = []  # [x, y, w, h]
    def get(self, x, y):
        if 0 <= x < MAP_W and 0 <= y < MAP_H:
            return self.g[y][x]
        return VOID
    def put(self, x, y, c):
        if 1 <= x < MAP_W - 1 and 1 <= y < MAP_H - 1:
            self.g[y][x] = c
    def rect(self, x, y, w, h, c=FLOOR):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)
    def hcorr(self, x1, x2, y):
        for x in range(min(x1, x2), max(x1, x2) + 1):
            self.put(x, y, FLOOR)
    def vcorr(self, y1, y2, x):
        for y in range(min(y1, y2), max(y1, y2) + 1):
            self.put(x, y, FLOOR)
    def connect(self, a, b, rng):
        ax, ay = a[0] + a[2] // 2, a[1] + a[3] // 2
        bx, by = b[0] + b[2] // 2, b[1] + b[3] // 2
        if rng.random() < 0.5:
            self.hcorr(ax, bx, ay); self.vcorr(ay, by, bx)
        else:
            self.vcorr(ay, by, ax); self.hcorr(ax, bx, by)
    def overlaps(self, x, y, w, h, gap=2):
        for r in self.rooms:
            if x < r[0] + r[2] + gap and x + w + gap > r[0] and y < r[1] + r[3] + gap and y + h + gap > r[1]:
                return True
        return False
    def walls(self):
        for y in range(1, MAP_H - 1):
            for x in range(1, MAP_W - 1):
                if self.g[y][x] == VOID:
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            if self.get(x + dx, y + dy) in (FLOOR, WATER, LAVA, DOOR, STAIRS):
                                self.g[y][x] = WALL
    def walkable(self, x, y):
        return self.get(x, y) in (FLOOR, DOOR, STAIRS)
    def reachable(self, sx, sy):
        seen = {(sx, sy)}
        q = deque([(sx, sy)])
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if (nx, ny) not in seen and self.walkable(nx, ny):
                    seen.add((nx, ny)); q.append((nx, ny))
        return seen


def place_rooms(f, rng, count, min_s, max_s, bounds, gap=2):
    x0, y0, x1, y1 = bounds
    tries = 0
    while len(f.rooms) < count and tries < 600:
        tries += 1
        w, h = rng.randint(min_s, max_s), rng.randint(min_s, max_s)
        x, y = rng.randint(x0, x1 - w), rng.randint(y0, y1 - h)
        if f.overlaps(x, y, w, h, gap):
            continue
        f.rooms.append([x, y, w, h]); f.rect(x, y, w, h)


def style_warren(f, rng, level):
    place_rooms(f, rng, 12 + min(6, level), 4, 10, (3, 3, MAP_W - 4, MAP_H - 4))
    for i in range(1, len(f.rooms)):
        f.connect(f.rooms[i - 1], f.rooms[i], rng)
    for _ in range(max(2, len(f.rooms) // 4)):
        a, b = rng.choice(f.rooms), rng.choice(f.rooms)
        if a is not b:
            f.connect(a, b, rng)


def style_gauntlet(f, rng, level):
    # A snake of rooms across the map, left to right then back.
    x, y = 4, rng.randint(6, 14)
    direction = 1
    row = 0
    while len(f.rooms) < 11 + min(5, level):
        w, h = rng.randint(5, 9), rng.randint(4, 7)
        if direction == 1 and x + w > MAP_W - 5 or direction == -1 and x - w < 4:
            row += 1
            y += rng.randint(11, 14)
            if y + 9 > MAP_H - 4:
                break
            direction = -direction
            x = 4 if direction == 1 else MAP_W - 5
            continue
        rx = x if direction == 1 else x - w
        f.rooms.append([rx, y, w, h]); f.rect(rx, y, w, h)
        if len(f.rooms) > 1:
            f.connect(f.rooms[-2], f.rooms[-1], rng)
        x = rx + w + rng.randint(3, 6) if direction == 1 else rx - rng.randint(3, 6)


def style_temple(f, rng, level):
    # Mirrored halls about a central axis, a nave down the middle.
    cx = MAP_W // 2
    nave_w = 6
    f.rooms.append([cx - nave_w // 2, 5, nave_w, 8]); f.rect(cx - nave_w // 2, 5, nave_w, 8)
    y = 16
    while y < MAP_H - 12 and len(f.rooms) < 14 + min(4, level):
        w, h = rng.randint(5, 8), rng.randint(4, 7)
        off = rng.randint(6, 14)
        for sx in (cx - off - w, cx + off):
            f.rooms.append([sx, y, w, h]); f.rect(sx, y, w, h)
        # A nave segment between them
        f.rooms.append([cx - 2, y, 4, h]); f.rect(cx - 2, y, 4, h)
        n = len(f.rooms)
        f.connect(f.rooms[n - 3], f.rooms[n - 1], rng); f.connect(f.rooms[n - 2], f.rooms[n - 1], rng)
        f.connect(f.rooms[n - 4] if n >= 4 else f.rooms[0], f.rooms[n - 1], rng)
        y += h + rng.randint(4, 7)
    # The sanctum at the end, last.
    f.rooms.append([cx - 5, y, 10, 8]); f.rect(cx - 5, y, 10, 8)
    f.connect(f.rooms[-2], f.rooms[-1], rng)


def style_ring(f, rng, level):
    cx, cy = MAP_W // 2, MAP_H // 2
    # Start room at the top of the ring; rooms around; the great hall in the middle, last.
    n = 8 + min(4, level)
    import math
    for i in range(n):
        ang = -math.pi / 2 + i * 2 * math.pi / n
        w, h = rng.randint(5, 8), rng.randint(4, 7)
        x = int(cx + math.cos(ang) * 24) - w // 2
        y = int(cy + math.sin(ang) * 22) - h // 2
        f.rooms.append([x, y, w, h]); f.rect(x, y, w, h)
        if i > 0:
            f.connect(f.rooms[i - 1], f.rooms[i], rng)
    f.connect(f.rooms[-1], f.rooms[0], rng)
    f.rooms.append([cx - 7, cy - 6, 14, 12]); f.rect(cx - 7, cy - 6, 14, 12)
    for i in (n // 4, n // 2, 3 * n // 4):
        f.connect(f.rooms[i], f.rooms[-1], rng)


def style_catacomb(f, rng, level):
    # A grid of cells joined by narrow passages, a few cells knocked together.
    cols, rows = 6, 5
    cell_w, cell_h = 9, 10
    ox, oy = 5, 6
    grid = {}
    for r in range(rows):
        for c in range(cols):
            if rng.random() < 0.18 and (r, c) != (0, 0) and (r, c) != (rows - 1, cols - 1):
                continue
            w, h = rng.randint(3, 6), rng.randint(3, 6)
            x = ox + c * cell_w + rng.randint(0, cell_w - w - 1)
            y = oy + r * cell_h + rng.randint(0, cell_h - h - 1)
            grid[(r, c)] = len(f.rooms)
            f.rooms.append([x, y, w, h]); f.rect(x, y, w, h)
    for (r, c), i in grid.items():
        for nr, nc in ((r, c + 1), (r + 1, c)):
            if (nr, nc) in grid:
                f.connect(f.rooms[i], f.rooms[grid[(nr, nc)]], rng)
    # The ossuary, last: bottom-right, enlarged.
    last = f.rooms[grid[(rows - 1, cols - 1)]]
    f.rooms.remove(last)
    last = [last[0] - 2, last[1] - 2, min(9, last[2] + 4), min(8, last[3] + 4)]
    f.rooms.append(last); f.rect(*last)
    # Connect stragglers to something.
    seen = f.reachable(f.rooms[0][0] + f.rooms[0][2] // 2, f.rooms[0][1] + f.rooms[0][3] // 2)
    for r in f.rooms[1:]:
        if (r[0] + r[2] // 2, r[1] + r[3] // 2) not in seen:
            f.connect(f.rooms[0], r, rng)


def style_lair(f, rng, level):
    # Small antechambers around a huge central lair, which is last.
    place_rooms(f, rng, 9 + min(4, level), 4, 7, (3, 3, MAP_W - 4, MAP_H - 4), gap=3)
    cx, cy = MAP_W // 2, MAP_H // 2
    # Clear a hole for the lair.
    f.rooms = [r for r in f.rooms if not (r[0] < cx + 10 and r[0] + r[2] > cx - 10 and r[1] < cy + 8 and r[1] + r[3] > cy - 8)]
    for y in range(cy - 8, cy + 8):
        for x in range(cx - 10, cx + 10):
            f.g[y][x] = VOID
    for i in range(1, len(f.rooms)):
        f.connect(f.rooms[i - 1], f.rooms[i], rng)
    f.rooms.append([cx - 9, cy - 7, 18, 14]); f.rect(cx - 9, cy - 7, 18, 14)
    for r in rng.sample(f.rooms[:-1], min(3, len(f.rooms) - 1)):
        f.connect(r, f.rooms[-1], rng)


def style_cavern(f, rng, level):
    # Cellular automata, then rooms are the biggest open pockets.
    g = [[rng.random() < 0.46 for _ in range(MAP_W)] for _ in range(MAP_H)]
    for _ in range(5):
        ng = [[True] * MAP_W for _ in range(MAP_H)]
        for y in range(1, MAP_H - 1):
            for x in range(1, MAP_W - 1):
                n = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if g[y + dy][x + dx])
                ng[y][x] = n >= 5
        g = ng
    for y in range(2, MAP_H - 2):
        for x in range(2, MAP_W - 2):
            if not g[y][x]:
                f.g[y][x] = FLOOR
    # Rooms: sample open pockets as 4x4 boxes of floor, spaced out.
    candidates = []
    for y in range(3, MAP_H - 7):
        for x in range(3, MAP_W - 7):
            if all(f.g[y + dy][x + dx] == FLOOR for dy in range(4) for dx in range(4)):
                candidates.append((x, y))
    rng.shuffle(candidates)
    for x, y in candidates:
        if len(f.rooms) >= 12 + min(4, level):
            break
        if f.overlaps(x, y, 4, 4, gap=6):
            continue
        f.rooms.append([x, y, 4, 4])
    if len(f.rooms) < 4:
        return style_warren(f, rng, level)
    # Make sure it all connects: carve between consecutive rooms.
    for i in range(1, len(f.rooms)):
        f.connect(f.rooms[i - 1], f.rooms[i], rng)
    # Strip floor not reachable from the start (isolated pockets).
    s = f.rooms[0]
    seen = f.reachable(s[0] + 2, s[1] + 2)
    for y in range(MAP_H):
        for x in range(MAP_W):
            if f.g[y][x] == FLOOR and (x, y) not in seen:
                f.g[y][x] = VOID


def style_flooded(f, rng, level):
    style_warren(f, rng, level)
    for r in f.rooms[1:]:
        if rng.random() < 0.5 and r[2] >= 5 and r[3] >= 4:
            pw, ph = max(2, r[2] // 2), max(2, r[3] // 2)
            f.rect(r[0] + rng.randint(0, r[2] - pw), r[1] + rng.randint(0, r[3] - ph), pw, ph, WATER)


STYLES = {
    'warren': style_warren, 'cavern': style_cavern, 'temple': style_temple, 'gauntlet': style_gauntlet,
    'ring': style_ring, 'catacomb': style_catacomb, 'lair': style_lair, 'flooded': style_flooded,
}

THEME_STYLES = {
    'clockwork_foundry': ['catacomb', 'gauntlet', 'ring'], 'jungle_ziggurat': ['temple', 'gauntlet'],
    'frozen_necropolis': ['catacomb', 'temple'], 'sky_citadel': ['ring', 'temple'], 'fungal_grotto': ['cavern', 'lair'],
    'pirate_cove': ['cavern', 'flooded'], 'astral_wreck': ['gauntlet', 'warren'], 'desert_tomb': ['temple', 'catacomb', 'gauntlet'],
    'haunted_theatre': ['ring', 'warren'], 'dream_labyrinth': ['warren', 'ring', 'catacomb'],
    'salt_mine_deeps': ['cavern', 'gauntlet'], 'drowned_lighthouse': ['flooded', 'gauntlet'], 'plague_hospice': ['catacomb', 'warren'],
    'giants_causeway': ['gauntlet', 'lair'], 'royal_crypt': ['catacomb', 'temple'], 'goblin_warren': ['warren', 'cavern'],
    'sunken_temple': ['flooded', 'temple'], 'vampire_castle': ['temple', 'ring'], 'abyssal_rift': ['cavern', 'lair'],
    'elemental_node_fire': ['cavern', 'lair'], 'ancient_dwarven_hall': ['temple', 'catacomb'], 'feywild_glade': ['cavern', 'ring'],
    'shadowfell_crossing': ['warren', 'gauntlet'], 'thieves_guild_den': ['warren', 'catacomb'], 'dragon_graveyard': ['cavern', 'lair'],
    'illithid_colony': ['cavern', 'warren'], 'wizards_tower_lore_loc': ['ring', 'temple'], 'celestial_observatory': ['ring', 'temple'],
}


def build_floor(rng, theme, level, last, style):
    for attempt in range(20):
        f = Floor()
        STYLES[style](f, rng, level)
        if len(f.rooms) < 4:
            continue
        # Lava in fire places, water in wet ones, on top of the style.
        if theme in ('elemental_node_fire', 'abyssal_rift'):
            for r in f.rooms[1:-1]:
                if rng.random() < 0.3 and r[2] >= 4 and r[3] >= 4:
                    f.rect(r[0] + 1, r[1] + 1, max(1, r[2] // 3), max(1, r[3] // 3), LAVA)
        for i in range(1, len(f.rooms)):
            f.connect(f.rooms[i - 1], f.rooms[i], rng)
        for r in f.rooms:
            f.put(r[0] + r[2] // 2, r[1] + r[3] // 2, FLOOR)
        f.walls()
        s, b = f.rooms[0], f.rooms[-1]
        scx, scy = s[0] + s[2] // 2, s[1] + s[3] // 2
        bcx, bcy = b[0] + b[2] // 2, b[1] + b[3] // 2
        if f.get(scx, scy) != FLOOR:
            continue
        seen = f.reachable(scx, scy)
        if (bcx, bcy) not in seen:
            continue
        # Every room reachable, or dropped.
        keep = [f.rooms[0]]
        for r in f.rooms[1:]:
            if (r[0] + r[2] // 2, r[1] + r[3] // 2) in seen:
                keep.append(r)
        if len(keep) < 4 or keep[-1] is not b:
            continue
        f.rooms = keep
        if not last:
            f.put(bcx, bcy, STAIRS)
        f.put(s[0] - 1, scy, DOOR)
        return f, seen
    raise RuntimeError('could not build a floor')


def encode(f):
    # Bounding box of anything that is not void, then RLE rows.
    xs = [x for y in range(MAP_H) for x in range(MAP_W) if f.g[y][x] != VOID]
    ys = [y for y in range(MAP_H) for x in range(MAP_W) if f.g[y][x] != VOID]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    rows = []
    for y in range(y0, y1 + 1):
        row = f.g[y][x0:x1 + 1]
        out = []
        i = 0
        while i < len(row):
            j = i
            while j < len(row) and row[j] == row[i]:
                j += 1
            n = j - i
            out.append((str(n) if n > 1 else '') + row[i])
            i = j
        rows.append(''.join(out))
    return x0, y0, rows


def floor_tiles(f, room, seen, taken):
    out = []
    for y in range(room[1], room[1] + room[3]):
        for x in range(room[0], room[0] + room[2]):
            if f.get(x, y) == FLOOR and (x, y) in seen and (x, y) not in taken:
                out.append((x, y))
    return out


def populate(rng, f, seen, theme, level, last, depth):
    monsters = []
    taken = set()
    max_cr = max(0.25, level // 2)
    roster = pool(theme, max_cr)
    for r in f.rooms[1:-1]:
        area = r[2] * r[3]
        n = min(3, 1 + (1 if area >= 55 else 0) + (1 if area >= 90 else 0))
        tiles = floor_tiles(f, r, seen, taken)
        rng.shuffle(tiles)
        for (x, y) in tiles[:n]:
            mid = rng.choice(roster)
            monsters.append({'id': mid, 'x': x, 'y': y}); taken.add((x, y))
    # The boss hall: a boss beside the stairs, with a guard or two on deep floors.
    b = f.rooms[-1]
    boss_cr = min(6, level + 1) if last else min(5, level)
    boss_pool = [i for i in THEMES.get(theme, []) if boss_cr - 0.5 <= CR[i] <= boss_cr + 0.5]
    if not boss_pool:
        boss_pool = [i for i in GENERIC if boss_cr - 0.5 <= CR[i] <= boss_cr + 0.5]
    boss_id = rng.choice(boss_pool)
    bcx, bcy = b[0] + b[2] // 2, b[1] + b[3] // 2
    tiles = floor_tiles(f, b, seen, taken)
    tiles.sort(key=lambda t: abs(t[0] - bcx) + abs(t[1] - bcy))
    boss_pos = tiles[0] if tiles else (bcx, bcy)
    taken.add(boss_pos)
    guards = []
    if level >= 3:
        for (x, y) in tiles[1:1 + (1 if level < 5 else 2)]:
            guards.append({'id': rng.choice(roster), 'x': x, 'y': y}); taken.add((x, y))
    return monsters + guards, {'id': boss_id, 'x': boss_pos[0], 'y': boss_pos[1]}


def js(s):
    return "'" + s.replace(chr(92), chr(92) * 2).replace("'", chr(92) + "'") + "'"


def main():
    dungeons = []
    used_names = set()
    theme_ids = [t for t, _, _ in LOCATION_IDS if t in THEMES]
    depths = [2] * 25 + [3] * 30 + [4] * 25 + [5] * 14 + [6] * 6
    master = random.Random(1066)
    master.shuffle(depths)
    for index in range(100):
        rng = random.Random(1000 + index)
        theme = theme_ids[index % len(theme_ids)]
        depth = depths[index]
        # A name that has not been used.
        for _ in range(50):
            kind = rng.choice(THEME_KINDS.get(theme, KINDS))
            form = rng.random()
            if form < 0.4:
                name = f"The {rng.choice(FIRST)}{rng.choice(SECOND)} {kind}"
            elif form < 0.75:
                name = f"{rng.choice(FIRST)}{rng.choice(SECOND)} {kind}"
            else:
                name = f"The {kind} of {rng.choice(FIRST)}{rng.choice(SECOND)}"
            if name not in used_names:
                break
        used_names.add(name)
        style = rng.choice(THEME_STYLES.get(theme, list(STYLES)))
        floors = []
        for level in range(1, depth + 1):
            last = level == depth
            f, seen = build_floor(rng, theme, level, last, style)
            monsters, boss = populate(rng, f, seen, theme, level, last, depth)
            x0, y0, rows = encode(f)
            floors.append({'x0': x0, 'y0': y0, 'rows': rows, 'rooms': f.rooms, 'monsters': monsters, 'boss': boss})
        desc = rng.choice(DESCRIPTIONS.get(theme, ['a dark place with a bad reputation']))
        blurb = f"{desc}; {STYLE_LINES[style]}, {depth} floors down"
        dungeons.append({'id': f'prebuilt_{index + 1:03d}', 'name': name, 'themeId': theme, 'style': style, 'description': blurb, 'floors': floors})

    lines = []
    lines.append('/**')
    lines.append(' * The hundred pre-built dungeons. GENERATED by tools/dungeons/build_prebuilt.py;')
    lines.append(' * do not edit by hand. Every layout, every monster and every boss below is fixed.')
    lines.append(' *')
    lines.append(' * Floors are stored as run-length rows over a bounding box (x0, y0):')
    lines.append(" * '#' wall, '.' floor, '+' door, '>' stairs down, '~' water, 'L' lava, ' ' void.")
    lines.append(' */')
    lines.append('')
    lines.append("import type { PrebuiltDungeon } from '../world/Prebuilt';")
    lines.append('')
    lines.append('export const PREBUILT_DUNGEONS: PrebuiltDungeon[] = [')
    for d in dungeons:
        lines.append('  {')
        lines.append(f"    id: {js(d['id'])}, name: {js(d['name'])}, themeId: {js(d['themeId'])}, style: {js(d['style'])},")
        lines.append(f"    description: {js(d['description'])},")
        lines.append('    floors: [')
        for fl in d['floors']:
            lines.append('      {')
            lines.append(f"        x0: {fl['x0']}, y0: {fl['y0']},")
            lines.append("        rows: [" + ', '.join(js(r) for r in fl['rows']) + '],')
            lines.append("        rooms: [" + ', '.join(f"[{r[0]}, {r[1]}, {r[2]}, {r[3]}]" for r in fl['rooms']) + '],')
            lines.append("        monsters: [" + ', '.join(f"[{js(m['id'])}, {m['x']}, {m['y']}]" for m in fl['monsters']) + '],')
            lines.append(f"        boss: [{js(fl['boss']['id'])}, {fl['boss']['x']}, {fl['boss']['y']}],")
            lines.append('      },')
        lines.append('    ],')
        lines.append('  },')
    lines.append('];')
    lines.append('')
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    total_floors = sum(len(d['floors']) for d in dungeons)
    total_monsters = sum(len(f['monsters']) for d in dungeons for f in d['floors'])
    print(f'wrote {len(dungeons)} dungeons, {total_floors} floors, {total_monsters} monsters, {os.path.getsize(OUT) // 1024} KB')


if __name__ == '__main__':
    main()
