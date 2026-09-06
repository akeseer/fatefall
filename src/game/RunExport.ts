/**
 * The run as text: something the player can paste anywhere.
 *
 * Pure. `Game` gathers the pieces; this lays them out as a plain chronicle
 * with headings, the way a campaign journal would read.
 */

export interface RunExportInput {
  partyName: string;
  members: string[];
  day: number;
  acts: string[];
  roads: string[];
  deeds: string[];
  notes: string[];
  fallen: string[];
  titles: string[];
  numbers: string[];
}

function section(title: string, lines: string[], empty: string): string {
  const body = lines.length ? lines.map(l => `- ${l}`).join('\n') : `- ${empty}`;
  return `${title}\n${'-'.repeat(title.length)}\n${body}`;
}

export function exportRun(r: RunExportInput): string {
  const parts = [
    `${r.partyName.toUpperCase()}\nA Fatefall chronicle, day ${r.day}.`,
    section('The party', r.members, 'No one, which is its own story.'),
    section('The tale of the shattered die', r.acts, 'No act has ended yet.'),
    section('Their own roads', r.roads, 'None dealt yet.'),
    section('Titles', r.titles, 'None yet.'),
    section('The fallen', r.fallen, 'None. So far.'),
    section('Deeds', r.deeds.slice(-40), 'Nothing written yet.'),
    section("The DM's notebook", r.notes, 'Empty.'),
    section('In numbers', r.numbers, ''),
  ];
  return parts.join('\n\n') + '\n';
}
