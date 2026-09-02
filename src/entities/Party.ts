import { GameCharacter } from './Character';
import { Vector2, manhattan } from '../engine/types';

export type UpcastPolicy = 'auto' | 'always' | 'never';

export class Party {
  /** Custom name for the adventuring party, shown on the title bar and start screen. */
  public partyName: string = 'The Unnamed Party';
  public members: GameCharacter[] = [];
  public formation: Vector2[] = []; // Relative to leader
  public leaderIndex: number = 0;
  /** The leader's recent tiles — followers funnel along this in tight spots. */
  private trail: Vector2[] = [];

  /** Casting doctrine: how aggressively casters spend higher slots to upcast. */
  public upcastPolicy: UpcastPolicy = 'auto';

  /** Generate a default party name from the leader and member count. */
  public generateDefaultName(): string {
    if (this.members.length === 0) return 'The Unnamed Party';
    const leader = this.leader;
    const suffixes = ['Company', 'Fellowship', 'Warband', 'Covenant', 'Brood', 'Coterie', 'Brigade', 'Fellowship of the Ring'];
    const idx = (leader.name.charCodeAt(0) + leader.name.length) % suffixes.length;
    this.partyName = `${leader.name}'s ${suffixes[idx]}`;
    return this.partyName;
  }

  get leader(): GameCharacter {
    return this.members[this.leaderIndex];
  }

  get alive(): GameCharacter[] {
    return this.members.filter(m => m.isAlive);
  }

  get isAlive(): boolean {
    return this.alive.length > 0;
  }

  /** Members still on their feet (hp > 0). */
  get conscious(): GameCharacter[] {
    return this.members.filter(m => m.isConscious);
  }

  get hasConscious(): boolean {
    return this.conscious.length > 0;
  }

  /** Downed but not dead — dying or stabilized. */
  get downed(): GameCharacter[] {
    return this.members.filter(m => !m.isDead && m.hp <= 0);
  }

  addMember(character: GameCharacter, formationSlot?: Vector2) {
    this.members.push(character);
    if (formationSlot) {
      this.formation.push(formationSlot);
    } else {
      // Default formation: staggered behind leader
      const i = this.members.length - 1;
      if (i === 0) {
        this.formation.push({ x: 0, y: 0 });
      } else {
        this.formation.push({
          x: i % 2 === 0 ? -1 : 1,
          y: -Math.ceil(i / 2),
        });
      }
    }
  }

  setPosition(leaderPos: Vector2, walkable?: (x: number, y: number) => boolean) {
    // Teleport-style placement (dungeon spawn, restore): snap followers to
    // their formation slots and forget the walking trail. When a slot would
    // land in a wall (a 1×4 column in a tiny room, say), the follower stacks
    // single-file behind the leader instead.
    this.trail = [];
    this.members.forEach((member, i) => {
      if (i === 0) {
        member.tile = { x: leaderPos.x, y: leaderPos.y };
        return;
      }
      const offset = this.formation[i] || { x: 0, y: 0 };
      const candidate = { x: leaderPos.x + offset.x, y: leaderPos.y + offset.y };
      if (!walkable || walkable(candidate.x, candidate.y)) {
        member.tile = candidate;
        return;
      }
      // Fall back: search outward from the slot for the nearest free
      // walkable tile (a 1×4 column in a tiny room needs somewhere to stand).
      let placed = false;
      for (let radius = 1; radius < 16 && !placed; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const cand = { x: candidate.x + dx, y: candidate.y + dy };
            if (!walkable(cand.x, cand.y)) continue;
            if (this.members.some((m2, j) => j < i && m2.tile.x === cand.x && m2.tile.y === cand.y)) continue;
            member.tile = cand;
            placed = true;
            break;
          }
        }
      }
      if (!placed) member.tile = candidate; // last resort — keep the slot
    });
  }

  /** True when the whole formation fits with its leader on tile (x, y). */
  formationFitsAt(walkable: (x: number, y: number) => boolean, x: number, y: number): boolean {
    for (let i = 1; i < this.members.length; i++) {
      const off = this.formation[i];
      if (off && !walkable(x + off.x, y + off.y)) return false;
    }
    return true;
  }

  /**
   * Rebuild the preferred formation shape: `cols` columns wide × `rows`
   * rows deep, the leader at the front-left. Followers fill the block from
   * front to back, left to right. The party adopts the new shape on its next
   * move wherever the space allows (tight corridors still funnel to single
   * file).
   */
  setFormation(rows: number, cols: number) {
    const slots: Vector2[] = [{ x: 0, y: 0 }];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue; // the leader's own slot
        slots.push({ x: c, y: -r });
      }
    }
    // Make sure every member has a slot — extend the last column downward.
    while (slots.length < this.members.length) {
      const prevSlot = slots[slots.length - 1] ?? { x: 0, y: 0 };
      slots.push({ x: prevSlot.x, y: prevSlot.y - 1 });
    }
    this.formation = slots;
  }

  /**
   * Place the followers after the leader has stepped onto `leaderPos`.
   *
   * When the preferred formation fits at the leader's new tile the party
   * snaps into it (2×2 block in rooms). Otherwise the party funnels
   * single-file along the leader's trail — 1×4-style — squeezing through
   * any passage the leader can walk, then spreads back out when space
   * returns. Followers move at most one tile per step, farthest first, and
   * never step onto an occupied tile, so members never overlap or clip
   * walls.
   */
  stepFollowers(walkable: (x: number, y: number) => boolean, leaderPos: Vector2) {
    const last = this.trail[this.trail.length - 1];
    if (!last || last.x !== leaderPos.x || last.y !== leaderPos.y) {
      this.trail.push({ ...leaderPos });
      if (this.trail.length > 64) this.trail.shift();
    }

    if (this.formationFitsAt(walkable, leaderPos.x, leaderPos.y)) {
      for (let i = 1; i < this.members.length; i++) {
        const off = this.formation[i];
        if (off) this.members[i].tile = { x: leaderPos.x + off.x, y: leaderPos.y + off.y };
      }
      return;
    }

    // Funnel: followers drift toward their trail slots, one tile per step.
    const leaderKey = `${leaderPos.x},${leaderPos.y}`;
    const occupied = new Set<string>([leaderKey]);
    for (const m of this.members) occupied.add(`${m.tile.x},${m.tile.y}`);

    const tryMove = (member: GameCharacter, target: Vector2, force: boolean): void => {
      const cur = member.tile;
      const ownKey = `${cur.x},${cur.y}`;
      // May vacate this tile — but never the leader's tile (the leader may
      // have just stepped onto a follower; that spot stays protected).
      if (ownKey !== leaderKey) occupied.delete(ownKey);
      const curD = manhattan(cur, target);
      let best: Vector2 | null = null;
      let bestD = force ? Infinity : curD;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!walkable(nx, ny)) continue;
        if (occupied.has(`${nx},${ny}`)) continue;
        const d = Math.abs(nx - target.x) + Math.abs(ny - target.y);
        if (d < bestD) {
          bestD = d;
          best = { x: nx, y: ny };
        }
      }
      if (best) member.tile = best;
      occupied.add(`${member.tile.x},${member.tile.y}`);
    };

    // Pass 1 — forced vacate: anyone standing on the leader's tile must
    // step off (the leader just moved onto them), even sideways.
    for (let i = 1; i < this.members.length; i++) {
      const member = this.members[i];
      if (member.tile.x === leaderPos.x && member.tile.y === leaderPos.y) {
        tryMove(member, this.trail[this.trail.length - 2] ?? leaderPos, true);
      }
    }

    // Pass 2 — drift toward trail slots, farthest first, improving only.
    for (let i = this.members.length - 1; i >= 1; i--) {
      const member = this.members[i];
      if (member.tile.x === leaderPos.x && member.tile.y === leaderPos.y) {
        occupied.add(`${member.tile.x},${member.tile.y}`);
        continue; // already handled (and still stuck — nothing available)
      }
      const target = this.trail[this.trail.length - 1 - i];
      if (target) tryMove(member, target, false);
    }
  }

  moveToward(target: Vector2): Vector2 {
    const leader = this.leader;
    const dx = Math.sign(target.x - leader.tile.x);
    const dy = Math.sign(target.y - leader.tile.y);

    if (dx !== 0 || dy !== 0) {
      const newPos = { x: leader.tile.x + dx, y: leader.tile.y + dy };
      this.setPosition(newPos);
    }

    return leader.tile;
  }

  /** Party-wide short rest: each living member spends hit dice to recover. */
  shortRest(): string[] {
    const messages = this.alive.map(member => member.shortRest());
    // Tending the fallen: a rest after a fight brings the dead back at 1 HP.
    // Reviving always succeeds, so the party can never get stuck crippled.
    for (const member of this.members) {
      if (member.isDead) {
        member.revive(1);
        messages.push(`${member.name} is tended to and brought back at 1 HP.`);
      }
    }
    return messages;
  }

  /** Party-wide long rest before descending: full recovery for everyone. */
  longRest(): string[] {
    return this.members.flatMap(member => member.longRest());
  }

  /** Set a custom party name (1-40 chars, stripped of leading/trailing whitespace). */
  setName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9\s'\-!&.]/g, '').trim().slice(0, 40);
    if (cleaned.length < 1) {
      this.partyName = this.generateDefaultName();
    } else {
      this.partyName = cleaned;
    }
    return this.partyName;
  }

  /** Find nearest enemy */
  findNearestEnemy(enemyPositions: { id: string; pos: Vector2 }[]): { id: string; pos: Vector2; distance: number } | null {
    let best: { id: string; pos: Vector2; distance: number } | null = null;
    for (const enemy of enemyPositions) {
      const d = manhattan(this.leader.tile, enemy.pos);
      if (!best || d < best.distance) {
        best = { ...enemy, distance: d };
      }
    }
    return best;
  }
}