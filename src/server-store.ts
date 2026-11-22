// The profiles snapshot lives in one plugin key-value row, wrapped with a version so the stored shape
// can change later. Mutations run one at a time, so each sees the latest snapshot.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { INITIAL_SNAPSHOT, parseSnapshot, type Snapshot } from "./profiles";

const KEY = "profiles";
const VERSION = 1;

function parseDocument(stored: unknown): Snapshot {
  try {
    if (typeof stored !== "object" || stored === null || !("version" in stored) || !("snapshot" in stored))
      throw new Error("Unsupported stored profiles document");
    if (stored.version !== VERSION) throw new Error("Unsupported stored profiles version");
    return parseSnapshot(stored.snapshot);
  } catch (error) {
    throw new Error(`Cannot read stored profiles: ${error instanceof Error ? error.message : "Invalid document"}`);
  }
}

export function createProfilesStore(kv: BbPluginApi["storage"]["kv"]) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task);
    tail = next.catch(() => {});
    return next;
  }
  async function read(): Promise<Snapshot> {
    const stored = await kv.get<unknown>(KEY);
    return stored === undefined ? INITIAL_SNAPSHOT : parseDocument(stored);
  }
  async function write(snapshot: Snapshot, revision: number): Promise<Snapshot> {
    const next = parseSnapshot({ ...snapshot, revision });
    await kv.set(KEY, { version: VERSION, snapshot: next });
    return next;
  }
  return {
    read,
    /** Applies a change to the latest snapshot and bumps the revision. */
    mutate: (change: (current: Snapshot) => Snapshot): Promise<Snapshot> =>
      serial(async () => {
        const current = await read();
        return write(change(current), current.revision + 1);
      }),
    /** Replaces the whole snapshot (import). An unreadable stored document does not block it. */
    replace: (snapshot: Snapshot): Promise<Snapshot> =>
      serial(async () => {
        const current = await read().catch(() => null);
        return write(snapshot, (current?.revision ?? snapshot.revision) + 1);
      }),
  };
}
