import type { HookName, HookPayloads } from "./types.ts";

type Handler<K extends HookName> = (payload: HookPayloads[K]) => Promise<void> | void;

interface Subscription<K extends HookName> {
  pluginId: string;
  handler: Handler<K>;
}

/**
 * In-process hook bus. Handlers fire sequentially in subscription order so a
 * plugin reacting to "order.created" sees the same view of the world the
 * next plugin sees. One handler throwing never blocks the others — the
 * error is logged with the offending pluginId + hook name.
 *
 * Sequential (not parallel) on purpose: hooks frequently write to the same
 * DB rows (notifications, audit log, role sync). Parallel would race.
 */
export class HookBus {
  private subs = new Map<HookName, Subscription<any>[]>();

  subscribe<K extends HookName>(pluginId: string, hook: K, handler: Handler<K>): void {
    const list = this.subs.get(hook) ?? [];
    list.push({ pluginId, handler });
    this.subs.set(hook, list);
  }

  async emit<K extends HookName>(hook: K, payload: HookPayloads[K]): Promise<void> {
    const list = this.subs.get(hook) ?? [];
    for (const s of list) {
      try {
        await s.handler(payload);
      } catch (e) {
        console.error(`[plugin/hook] ${s.pluginId} ${hook} threw: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

/** Process-wide singleton. Imported by both loader.ts and core emitters. */
export const hookBus = new HookBus();
