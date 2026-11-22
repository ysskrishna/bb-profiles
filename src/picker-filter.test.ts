import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { installPickerFilter, type QueryClientLike, type QueryOptionsLike } from "./picker-filter";
import { limit, pickerState, profile, snapshotOf } from "./test-utils";

const catalog = {
  providers: [{ id: "custom" }],
  models: [
    { model: "a", displayName: "A" },
    { model: "b", displayName: "B" },
    { model: "c", displayName: "C" },
  ],
  selectedOnlyModels: [] as { model: string; displayName?: string }[],
};
type Catalog = typeof catalog;
const key = ["systemExecutionOptions", null, "host", "custom", null];
const ids = (list: { model: string }[]) => [...list].map((m) => m.model);
const modelsOf = (data: unknown) => ids((data as Catalog).models);
const onlyB = pickerState(snapshotOf({ custom: limit("b") }, { hiddenModels: "remove" }));
const onlyC = pickerState(snapshotOf({ custom: limit("c") }, { hiddenModels: "remove" }));

/** A hand-rolled client: one picker query with one observer, and a cache that reports its listeners. */
function fakeHost(initial: QueryOptionsLike = { queryKey: key, placeholderData: () => catalog }) {
  const listeners = new Set<(event: unknown) => void>();
  const client: QueryClientLike = {
    defaultQueryOptions: (options) => options,
    getQueryCache: () => ({
      getAll: () => [query],
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  };
  const observer = {
    options: initial,
    result: catalog as unknown,
    setOptions(options: QueryOptionsLike) {
      this.options = client.defaultQueryOptions(options);
      this.result = this.options.select ? this.options.select(catalog) : catalog;
    },
  };
  const query = { queryKey: key, observers: [observer] };
  return { client, observer, listeners };
}

describe("picker filter with a stand-in client", () => {
  it("projects existing observers, leaves the raw catalog alone, and restores them on dispose", () => {
    const { client, observer } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    expect(modelsOf(observer.result)).toEqual(["b"]);
    expect(ids(catalog.models)).toEqual(["a", "b", "c"]);
    expect([...(observer.result as Catalog).selectedOnlyModels]).toHaveLength(2);
    filter.dispose();
    expect(observer.result).toBe(catalog);
    expect(observer.options.select).toBeUndefined();
  });
  it("rotates the select and placeholder identities on update and keeps them stable otherwise", () => {
    const { client, observer } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    const { select, placeholderData } = observer.options;
    const again = client.defaultQueryOptions(observer.options);
    expect(again.select).toBe(select);
    expect(again.placeholderData).toBe(placeholderData);
    filter.update(onlyC);
    expect(observer.options.select).not.toBe(select);
    expect(observer.options.placeholderData).not.toBe(placeholderData);
    const placeholder = (observer.options.placeholderData as () => unknown)();
    expect(modelsOf(observer.options.select?.(placeholder))).toEqual(["c"]);
    filter.dispose();
  });
  it("composes an existing selector, ignores other queries, and returns the selector on dispose", () => {
    const native = (data: unknown) => modelsOf(data);
    const { client, observer } = fakeHost({ queryKey: key, select: native });
    const filter = installPickerFilter(client, onlyB);
    expect(observer.result).toEqual(["b"]);
    const unrelated = { queryKey: ["threads"], select: native };
    expect(client.defaultQueryOptions(unrelated)).toBe(unrelated);
    const longer = { queryKey: [...key, "model", "extra"] };
    expect(client.defaultQueryOptions(longer)).toBe(longer);
    filter.dispose();
    expect(observer.options.select).toBe(native);
  });
  it("accepts the six-part key that carries a selected model", () => {
    const { client } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    const options = client.defaultQueryOptions({ queryKey: [...key, "b"] });
    expect(modelsOf(options.select?.(catalog))).toEqual(["b"]);
    filter.dispose();
  });
  it("uses the provider BB actually returned when the requested one is missing", () => {
    const { client } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    const options = client.defaultQueryOptions({ queryKey: [...key.slice(0, 3), "missing", null] });
    expect(modelsOf(options.select?.(catalog))).toEqual(["b"]);
    filter.dispose();
  });
  it("hands data that is not a model catalog through untouched", () => {
    const { client } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    const options = client.defaultQueryOptions({ queryKey: key });
    const odd = { providers: "none" };
    expect(options.select?.(odd)).toBe(odd);
    filter.dispose();
  });
  it("leaves a later wrapper in place on dispose and turns retained selectors inert", () => {
    const { client, observer } = fakeHost();
    const original = client.defaultQueryOptions;
    const filter = installPickerFilter(client, onlyB);
    const retained = observer.options.select as (data: unknown) => unknown;
    const ours = client.defaultQueryOptions;
    const other = (options: QueryOptionsLike) => ours(options);
    client.defaultQueryOptions = other;
    filter.dispose();
    expect(client.defaultQueryOptions).toBe(other);
    expect(retained(catalog)).toBe(catalog);
    client.defaultQueryOptions = original;
  });
  it("covers observers added later and drops its cache subscription once", () => {
    const { client, observer, listeners } = fakeHost();
    const filter = installPickerFilter(client, onlyB);
    expect(listeners.size).toBe(1);
    const late = { options: { queryKey: key } as QueryOptionsLike, setOptions: observer.setOptions };
    for (const listener of listeners) listener({ type: "observerAdded", observer: late });
    expect(modelsOf(late.options.select?.(catalog))).toEqual(["b"]);
    for (const listener of listeners) listener({ type: "queryUpdated", observer: late });
    filter.dispose();
    filter.dispose();
    expect(listeners.size).toBe(0);
  });
  it("leaves the client as it was when applying to existing observers fails", () => {
    const { client, observer, listeners } = fakeHost();
    const original = client.defaultQueryOptions;
    observer.setOptions = () => {
      throw new Error("boom");
    };
    expect(() => installPickerFilter(client, onlyB)).toThrow("boom");
    expect(client.defaultQueryOptions).toBe(original);
    expect(listeners.size).toBe(0);
  });
  it("refuses a client whose options cannot be wrapped", () => {
    const { client } = fakeHost();
    Object.defineProperty(client, "defaultQueryOptions", { value: (o: QueryOptionsLike) => o, writable: false });
    expect(() => installPickerFilter(client, onlyB)).toThrow();
  });
  it("resolves the project from the environment map, then the composer project", () => {
    const { client } = fakeHost();
    const snapshot = snapshotOf(
      {},
      {
        others: [
          profile("only-b", { custom: limit("b") }, { projectIds: ["p1"] }),
          profile("only-c", { custom: limit("c") }, { projectIds: ["p2"] }),
        ],
      },
    );
    const filter = installPickerFilter(
      client,
      pickerState(snapshot, { environmentProjects: { env1: "p1" }, composerProjectId: "p2" }),
    );
    const models = (k: unknown[]) => modelsOf(client.defaultQueryOptions({ queryKey: k }).select?.(catalog));
    expect(models(["systemExecutionOptions", "env1", "host", "custom", null])).toEqual(["b"]);
    expect(models(key)).toEqual(["c"]);
    filter.update(pickerState(snapshot, { composerProjectId: null }));
    expect(models(key)).toEqual(["a", "b", "c"]);
    filter.dispose();
  });
  it("reports an unknown environment and uses Default meanwhile", async () => {
    const { client } = fakeHost();
    const seen: string[] = [];
    const filter = installPickerFilter(client, pickerState(snapshotOf({ custom: limit("a") })), (id) => seen.push(id));
    const options = client.defaultQueryOptions({
      queryKey: ["systemExecutionOptions", "env9", "host", "custom", null],
    });
    expect((options.select?.(catalog) as Catalog).models).toHaveLength(1);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(["env9"]);
    filter.dispose();
  });
});

describe("picker filter with TanStack's own observers", () => {
  const raw = { ...catalog };
  const selectedKey = [...key, "b"];
  const subscribed = (client: QueryClient, queryKey: unknown[], options: Record<string, unknown> = {}) => {
    const observer = new QueryObserver<Catalog>(client, { queryKey, enabled: false, ...options });
    return { observer, stop: observer.subscribe(() => {}) };
  };

  it("filters selected-model queries without changing the cached catalog, and follows updates", () => {
    const client = new QueryClient();
    client.setQueryData(selectedKey, raw);
    const filter = installPickerFilter(client as unknown as QueryClientLike, onlyB);
    const { observer, stop } = subscribed(client, selectedKey);
    try {
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["b"]);
      expect(client.getQueryData(selectedKey)).toEqual(raw);
      filter.update(onlyC);
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["c"]);
      // Structural sharing must not strip the remove-mode facade across updates.
      filter.update(onlyB);
      const more = observer.getCurrentResult().data?.selectedOnlyModels ?? [];
      expect(more.filter(() => true)).toEqual([]);
      expect(more.find((m) => m.model === "c")).toMatchObject({ displayName: "C (Current)" });
    } finally {
      stop();
      filter.dispose();
    }
  });
  it("filters a remembered placeholder and recomputes it after a rule change", () => {
    const client = new QueryClient();
    const filter = installPickerFilter(client as unknown as QueryClientLike, onlyB);
    const { observer, stop } = subscribed(client, key, { placeholderData: () => raw });
    try {
      const first = observer.getCurrentResult();
      expect(first.isPlaceholderData).toBe(true);
      expect(ids(first.data?.models ?? [])).toEqual(["b"]);
      filter.update(onlyC);
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["c"]);
    } finally {
      stop();
      filter.dispose();
    }
  });
  it("projects for observers created after installing, keeping the raw cache intact", () => {
    const client = new QueryClient();
    client.setQueryData(key, raw);
    const filter = installPickerFilter(client as unknown as QueryClientLike, onlyB);
    const { observer, stop } = subscribed(client, key);
    try {
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["b"]);
      expect(client.getQueryData(key)).toBe(raw);
    } finally {
      stop();
      filter.dispose();
    }
  });
  it("restores observers that existed before installing", () => {
    const client = new QueryClient();
    client.setQueryData(key, raw);
    const { observer, stop } = subscribed(client, key);
    const filter = installPickerFilter(client as unknown as QueryClientLike, onlyB);
    try {
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["b"]);
      filter.dispose();
      expect(ids(observer.getCurrentResult().data?.models ?? [])).toEqual(["a", "b", "c"]);
    } finally {
      stop();
    }
  });
});
