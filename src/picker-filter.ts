// Filters BB's model picker by wrapping the query client's option defaults.
//
// BB's picker reads `["systemExecutionOptions", environmentId, hostId, providerId, projectId, selectedModel?]`
// queries. Adding a `select` to those queries projects the catalog through the profile of the project the
// picker belongs to, while the cached response stays untouched.
import { projectCatalog } from "./picker-projection";
import { resolveProfile, type Snapshot } from "./profiles";

/** Everything the projection depends on besides the response itself. */
export interface PickerState {
  snapshot: Snapshot;
  /** environment id -> project id. */
  environmentProjects: Readonly<Record<string, string | null>>;
  /** Project of the mounted new-thread composer, if any. */
  composerProjectId: string | null;
}

type Select = (data: unknown) => unknown;
export interface QueryOptionsLike {
  queryKey?: readonly unknown[];
  select?: Select;
  placeholderData?: unknown;
  [key: string]: unknown;
}
interface ObserverLike {
  options: QueryOptionsLike;
  setOptions(options: QueryOptionsLike): void;
}
interface QueryLike {
  queryKey: readonly unknown[];
  observers: ObserverLike[];
}
export interface QueryClientLike {
  defaultQueryOptions(options: QueryOptionsLike): QueryOptionsLike;
  getQueryCache(): {
    getAll(): QueryLike[];
    subscribe(listener: (event: unknown) => void): () => void;
  };
}

interface RawModel {
  model: string;
}
interface RawCatalog {
  providers: { id: string }[];
  models: RawModel[];
  selectedOnlyModels: RawModel[];
}

const QUERY_NAME = "systemExecutionOptions";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isCatalog(value: unknown): value is RawCatalog {
  if (!isRecord(value)) return false;
  const { providers, models, selectedOnlyModels } = value;
  return (
    Array.isArray(providers) &&
    providers.every((p) => isRecord(p) && typeof p.id === "string") &&
    Array.isArray(models) &&
    models.every((m) => isRecord(m) && typeof m.model === "string") &&
    Array.isArray(selectedOnlyModels) &&
    selectedOnlyModels.every((m) => isRecord(m) && typeof m.model === "string")
  );
}

function isPickerKey(key: readonly unknown[] | undefined): key is readonly unknown[] {
  return key?.[0] === QUERY_NAME && (key.length === 5 || (key.length === 6 && typeof key[5] === "string"));
}

export function installPickerFilter(
  client: QueryClientLike,
  initial: PickerState,
  /** Called from a microtask with an environment id the map lacks, so the owner can refresh the map. */
  onUnknownEnvironment: (environmentId: string) => void = () => {},
): { update(next: PickerState): void; dispose(): void } {
  const original = client.defaultQueryOptions;
  let state = initial;
  let live = true;

  // Wrappers remember what they wrap, so options passed through us twice are never wrapped twice and
  // disposal can hand every observer its own functions back.
  const wrappedSelect = new WeakMap<Function, Select | undefined>();
  const wrappedPlaceholder = new WeakMap<Function, unknown>();
  // Wrappers must keep their identity between renders (TanStack memoizes on it) and change when the
  // state changes, so both caches live for one state only.
  let selectCache = new Map<string, Map<Select | undefined, Select>>();
  let placeholderCache = new Map<Function, Function>();

  const nativeSelect = (select: Select | undefined) =>
    select !== undefined && wrappedSelect.has(select) ? wrappedSelect.get(select) : select;
  const nativePlaceholder = (value: unknown) =>
    typeof value === "function" && wrappedPlaceholder.has(value) ? wrappedPlaceholder.get(value) : value;

  function projectIdFor(key: readonly unknown[]): string | null {
    const environmentId = typeof key[1] === "string" ? key[1] : null;
    if (environmentId === null) return state.composerProjectId;
    if (Object.hasOwn(state.environmentProjects, environmentId)) return state.environmentProjects[environmentId];
    queueMicrotask(() => onUnknownEnvironment(environmentId));
    return null;
  }

  function selectFor(key: readonly unknown[], native: Select | undefined): Select {
    const route = JSON.stringify(key);
    let byNative = selectCache.get(route);
    if (!byNative) {
      byNative = new Map();
      selectCache.set(route, byNative);
    }
    const cached = byNative.get(native);
    if (cached) return cached;
    const requested = typeof key[3] === "string" ? key[3] : null;
    const select: Select = (data) => {
      const projected =
        live && isCatalog(data)
          ? projectCatalog(
              data,
              resolveProfile(state.snapshot, projectIdFor(key)),
              state.snapshot.hiddenModels,
              requested,
            )
          : data;
      return native ? native(projected) : projected;
    };
    wrappedSelect.set(select, native);
    byNative.set(native, select);
    return select;
  }

  function placeholderFor(value: unknown): unknown {
    if (typeof value !== "function") return value;
    let wrapped = placeholderCache.get(value);
    if (!wrapped) {
      const call = value;
      wrapped = (...args: unknown[]) => Reflect.apply(call, undefined, args);
      placeholderCache.set(value, wrapped);
      wrappedPlaceholder.set(wrapped, value);
    }
    return wrapped;
  }

  function decorate(options: QueryOptionsLike): QueryOptionsLike {
    if (!live || !isPickerKey(options.queryKey)) return options;
    const select = selectFor(options.queryKey, nativeSelect(options.select));
    const placeholderData = placeholderFor(nativePlaceholder(options.placeholderData));
    if (options.select === select && options.placeholderData === placeholderData) return options;
    return { ...options, select, placeholderData };
  }

  const wrapper = function (this: QueryClientLike, options: QueryOptionsLike) {
    return decorate(original.call(this, options));
  };
  client.defaultQueryOptions = wrapper;
  if (client.defaultQueryOptions !== wrapper) throw new Error("BB's query client does not allow the required adapter.");

  const pickerObservers = () =>
    client
      .getQueryCache()
      .getAll()
      .filter((query) => isPickerKey(query.queryKey))
      .flatMap((query) => [...query.observers]);

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (!isRecord(event) || event.type !== "observerAdded" || !isRecord(event.observer)) return;
    const observer = event.observer as unknown as ObserverLike;
    if (typeof observer.setOptions !== "function" || !isRecord(observer.options)) return;
    if (isPickerKey(observer.options.queryKey) && decorate(observer.options) !== observer.options)
      observer.setOptions(observer.options);
  });

  function stop() {
    live = false;
    unsubscribe();
    if (client.defaultQueryOptions === wrapper) client.defaultQueryOptions = original;
  }

  try {
    for (const observer of pickerObservers()) observer.setOptions(observer.options);
  } catch (error) {
    stop();
    throw error;
  }

  return {
    update(next) {
      if (!live) return;
      state = next;
      selectCache = new Map();
      placeholderCache = new Map();
      for (const observer of pickerObservers()) observer.setOptions(observer.options);
    },
    dispose() {
      if (!live) return;
      stop();
      for (const observer of pickerObservers()) {
        const { options } = observer;
        observer.setOptions({
          ...options,
          select: nativeSelect(options.select),
          placeholderData: nativePlaceholder(options.placeholderData),
        });
      }
      selectCache.clear();
      placeholderCache.clear();
    },
  };
}

/** Finds BB's query client from a React fiber above (or at) a mounted element. */
export function locateQueryClient(anchor: HTMLElement): QueryClientLike | null {
  const fiberKey = Object.getOwnPropertyNames(anchor).find((name) => name.startsWith("__reactFiber$"));
  if (fiberKey === undefined) return null;
  const visited = new Set<unknown>();
  let fiber: unknown = Reflect.get(anchor, fiberKey);
  while (isRecord(fiber) && !visited.has(fiber) && visited.size < 256) {
    visited.add(fiber);
    const props = fiber.memoizedProps;
    for (const candidate of isRecord(props) ? [props.value, props.client] : []) {
      if (isQueryClient(candidate)) return candidate;
    }
    fiber = fiber.return;
  }
  return null;
}

function isQueryClient(value: unknown): value is QueryClientLike {
  if (!isRecord(value) || typeof value.defaultQueryOptions !== "function" || typeof value.getQueryCache !== "function")
    return false;
  const cache: unknown = Reflect.apply(value.getQueryCache, value, []);
  return isRecord(cache) && typeof cache.getAll === "function" && typeof cache.subscribe === "function";
}
