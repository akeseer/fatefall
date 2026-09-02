/**
 * Remappable battle-menu hotkeys, persisted in localStorage.
 *
 * Codes are KeyboardEvent.code values (layout-stable): 'Digit1', 'KeyQ',
 * 'Tab', … The quick-cast fires with Shift held over its code.
 */

export type BindAction =
  | 'attack'
  | 'spell'
  | 'item'
  | 'flee'
  | 'quickcast'
  | 'heroNext'
  | 'formationStandard'
  | 'formationCareful'
  | 'formationReckless';

export type BindMap = Record<BindAction, string>;

export const DEFAULT_KEYBINDS: BindMap = {
  attack: 'Digit1',
  spell: 'Digit2',
  item: 'Digit3',
  flee: 'Digit4',
  quickcast: 'Digit2', // fired with Shift held
  heroNext: 'Tab',
  formationStandard: 'KeyQ',
  formationCareful: 'KeyW',
  formationReckless: 'KeyE',
};

const LS_KEY = 'dungeon-party-keybinds-v1';

/** Load binds from localStorage, merged over defaults (new actions keep defaults). */
export function loadKeybinds(): BindMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDS };
    const parsed = JSON.parse(raw) as Partial<BindMap>;
    const merged = { ...DEFAULT_KEYBINDS };
    for (const k of Object.keys(DEFAULT_KEYBINDS) as BindAction[]) {
      const v = parsed[k];
      if (typeof v === 'string' && v.length > 0) merged[k] = v;
    }
    return merged;
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
}

/** Persist binds; failures (private mode, quota) are non-fatal. */
export function saveKeybinds(binds: BindMap): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(binds));
  } catch {
    /* ignore */
  }
}

/** Human label for a KeyboardEvent.code ('Digit1'→'1', 'KeyQ'→'Q', …). */
export function labelFor(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const named: Record<string, string> = {
    Tab: 'Tab', Space: 'Space', Enter: 'Enter', Escape: 'Esc',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'LShift', ShiftRight: 'RShift',
    ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  };
  return named[code] ?? code;
}

/** Actions shown in the F1 remap overlay, in display order. */
export const BIND_ORDER: { action: BindAction; name: string; hint: string }[] = [
  { action: 'attack', name: 'Attack', hint: 'strike — opens target selection' },
  { action: 'spell', name: 'Spell', hint: 'open the spell submenu' },
  { action: 'item', name: 'Item', hint: 'open the item submenu' },
  { action: 'flee', name: 'Flee', hint: 'disengage the fight' },
  { action: 'quickcast', name: 'Quick-Cast', hint: 'Shift + key: recast last spell' },
  { action: 'heroNext', name: 'Next Hero', hint: 'cycle the menu to another hero' },
  { action: 'formationStandard', name: 'Formation: Standard', hint: 'queue the party opener' },
  { action: 'formationCareful', name: 'Formation: Careful', hint: 'steady line, heal up' },
  { action: 'formationReckless', name: 'Formation: Reckless', hint: 'everyone attacks' },
];
