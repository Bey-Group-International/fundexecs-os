/**
 * FundExecs OS — office plugin registry.
 *
 * Ported in spirit from `bagidea-office` (MIT), whose office is extended through
 * a plugin ecosystem of custom UI panels and agent-driven commands, and from
 * `AIOffice` (MIT), whose agents appear as interactive "employee" panels. This
 * is the native, framework-light core of that: a typed registry where a plugin
 * contributes HUD panels and floor commands, gated by office context.
 *
 * The registry itself imports no React and touches no DOM — it holds plain
 * descriptors and answers "what panels/commands apply in this context?", so it
 * is fully unit-testable. A thin React layer consumes it to actually mount the
 * panels; the descriptors carry a `render` key (an opaque component token) that
 * that layer resolves, keeping this core presentation-agnostic.
 *
 * Attribution: concepts from https://github.com/bagidea/bagidea-office (MIT)
 * and https://github.com/ChristianFJung/AIOffice (MIT).
 */

/** Where a panel is mounted in the office chrome. */
export type PanelSlot = "hud" | "left" | "right" | "dock" | "modal";

/** Office state a plugin can gate its contributions on. */
export type OfficeContext = {
  roomKey?: string | null;
  role?: string;
  mode?: string;
};

/** A UI panel contributed by a plugin. `render` is an opaque token the React
 *  layer resolves to a component — kept `unknown` so this core stays UI-free. */
export type OfficePanel = {
  id: string;
  title: string;
  slot: PanelSlot;
  icon?: string;
  /** Lower renders first within a slot; defaults to 0. */
  order?: number;
  /** Owning plugin id, set automatically by `definePlugin`. */
  source?: string;
  /** Optional visibility predicate evaluated against the office context. */
  visibleWhen?: (ctx: OfficeContext) => boolean;
  /** Opaque component reference resolved by the React consumer. */
  render?: unknown;
};

/** A floor command contributed by a plugin (command palette / room action). */
export type OfficeCommand = {
  id: string;
  label: string;
  icon?: string;
  source?: string;
  /** What triggering the command does. */
  kind: "navigate" | "event" | "agent";
  /** href (navigate), CustomEvent name (event), or agent id (agent). */
  target: string;
  visibleWhen?: (ctx: OfficeContext) => boolean;
};

/** A plugin bundle: a named set of panels + commands registered together. */
export type OfficePlugin = {
  id: string;
  panels?: OfficePanel[];
  commands?: OfficeCommand[];
};

const byOrderThenId = <T extends { order?: number; id: string }>(a: T, b: T): number =>
  (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);

const passes = (visibleWhen: ((ctx: OfficeContext) => boolean) | undefined, ctx: OfficeContext): boolean =>
  visibleWhen ? visibleWhen(ctx) : true;

/**
 * The registry. Use the exported `officePlugins` singleton in the app; construct
 * a fresh instance in tests for isolation.
 */
export class OfficePluginRegistry {
  private readonly panels = new Map<string, OfficePanel>();
  private readonly commands = new Map<string, OfficeCommand>();

  /** Register one panel. Throws on a duplicate id unless `override` is set. */
  registerPanel(panel: OfficePanel, override = false): void {
    if (!override && this.panels.has(panel.id)) {
      throw new Error(`Office panel "${panel.id}" is already registered`);
    }
    this.panels.set(panel.id, panel);
  }

  /** Register one command. Throws on a duplicate id unless `override` is set. */
  registerCommand(command: OfficeCommand, override = false): void {
    if (!override && this.commands.has(command.id)) {
      throw new Error(`Office command "${command.id}" is already registered`);
    }
    this.commands.set(command.id, command);
  }

  /**
   * Register a whole plugin bundle, stamping each contribution with the plugin
   * id as its `source`. Returns an unregister function that removes exactly what
   * this call added — so a plugin can be cleanly torn down (e.g. on unmount).
   */
  register(plugin: OfficePlugin, override = false): () => void {
    const panelIds: string[] = [];
    const commandIds: string[] = [];
    for (const panel of plugin.panels ?? []) {
      this.registerPanel({ ...panel, source: plugin.id }, override);
      panelIds.push(panel.id);
    }
    for (const command of plugin.commands ?? []) {
      this.registerCommand({ ...command, source: plugin.id }, override);
      commandIds.push(command.id);
    }
    return () => {
      for (const id of panelIds) this.panels.delete(id);
      for (const id of commandIds) this.commands.delete(id);
    };
  }

  removePanel(id: string): void {
    this.panels.delete(id);
  }
  removeCommand(id: string): void {
    this.commands.delete(id);
  }

  /** All panels for a slot, honoring `visibleWhen`, sorted by order then id. */
  panelsFor(slot: PanelSlot, ctx: OfficeContext = {}): OfficePanel[] {
    return [...this.panels.values()]
      .filter((p) => p.slot === slot && passes(p.visibleWhen, ctx))
      .sort(byOrderThenId);
  }

  /** All commands visible in a context, sorted by id. */
  commandsFor(ctx: OfficeContext = {}): OfficeCommand[] {
    return [...this.commands.values()]
      .filter((c) => passes(c.visibleWhen, ctx))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Snapshot of every registered panel (unsorted). */
  allPanels(): OfficePanel[] {
    return [...this.panels.values()];
  }
  /** Snapshot of every registered command (unsorted). */
  allCommands(): OfficeCommand[] {
    return [...this.commands.values()];
  }

  /** Remove everything — primarily for test isolation. */
  clear(): void {
    this.panels.clear();
    this.commands.clear();
  }
}

/** App-wide singleton. Plugins register against this at module load. */
export const officePlugins = new OfficePluginRegistry();

/** Small helper so a plugin author writes a plain object and gets type checking. */
export function definePlugin(plugin: OfficePlugin): OfficePlugin {
  return plugin;
}
