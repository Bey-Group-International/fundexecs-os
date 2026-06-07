/**
 * The real keyboard shortcuts surfaced in the account menu's "Keyboard
 * shortcuts" overlay. Kept in one place so the overlay and any future help
 * surface stay in sync with what the app actually binds.
 */
export interface KeyboardShortcut {
  /** Human-readable key combo, already platform-neutral (⌘ shown for meta). */
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  heading: string;
  shortcuts: KeyboardShortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    heading: 'Global',
    shortcuts: [
      { keys: ['⌘', 'K'], label: 'Jump to a deal, LP, or agent action (command + search)' },
      { keys: ['Esc'], label: 'Close the open menu, drawer, or dialog' }
    ]
  },
  {
    heading: 'Account menu',
    shortcuts: [
      { keys: ['↑', '↓'], label: 'Move between menu items' },
      { keys: ['Enter'], label: 'Open the focused item' },
      { keys: ['Tab'], label: 'Cycle focus inside the open menu' }
    ]
  },
  {
    heading: 'Navigation',
    shortcuts: [{ keys: ['Tab'], label: 'Move through the side rail and content' }]
  }
];
