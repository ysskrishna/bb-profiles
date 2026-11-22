// Reduces BB's model-list response to what a profile shows in the picker.
import { getProviderRule, type HiddenModels, type Profile } from "./profiles";

interface CatalogModel {
  model: string;
  displayName?: string;
}
interface Catalog {
  providers: { id: string }[];
  models: CatalogModel[];
  selectedOnlyModels?: CatalogModel[];
}

function dedupe<M extends CatalogModel>(models: M[]): M[] {
  const seen = new Set<string>();
  return models.filter((item) => {
    if (seen.has(item.model)) return false;
    seen.add(item.model);
    return true;
  });
}

/**
 * The "More models" list in remove mode. BB resolves the current model through
 * the whole list (spread and `find`) and renders the submenu through `filter`.
 * Iteration therefore keeps every model, `find` labels a hidden hit as the
 * current model, and `filter` sees only models the profile selects.
 *
 * The own function members matter: TanStack's structural sharing rebuilds
 * arrays made only of indexed items, which would drop them.
 */
function currentOnlyList(all: CatalogModel[], chosen: ReadonlySet<string>): CatalogModel[] {
  const listed = all.filter((item) => chosen.has(item.model));
  const find = (predicate: (item: CatalogModel, index: number, list: CatalogModel[]) => unknown, thisArg?: unknown) => {
    const hit = Array.prototype.find.call(all, predicate, thisArg) as CatalogModel | undefined;
    if (hit === undefined || chosen.has(hit.model)) return hit;
    return { ...hit, displayName: `${hit.displayName ?? hit.model} (Current)` };
  };
  const filter = (predicate: (item: CatalogModel, index: number, list: CatalogModel[]) => unknown, thisArg?: unknown) =>
    listed.filter(predicate, thisArg);
  return Object.assign([...all], { find, filter });
}

/**
 * Providers the profile turns off are dropped, except the one the list was
 * requested for. When the profile limits that provider, the main list keeps the
 * selected models and the rest go to "More models" or, in remove mode, out of
 * the picker. A limit that matches nothing in the catalog changes nothing.
 */
export function projectCatalog<T extends Catalog>(
  catalog: T,
  profile: Profile,
  mode: HiddenModels,
  requestedProvider: string | null,
): T {
  const focus =
    requestedProvider !== null && catalog.providers.some((p) => p.id === requestedProvider)
      ? requestedProvider
      : catalog.providers[0]?.id;
  const providers = catalog.providers.filter(
    (p) => p.id === focus || getProviderRule(profile, p.id)?.enabled !== false,
  );
  const shown: T = providers.length === catalog.providers.length ? catalog : { ...catalog, providers };
  const rule = focus === undefined ? undefined : getProviderRule(profile, focus);
  if (!rule?.limit) return shown;

  const chosen = new Set(rule.modelIds);
  const alreadyMore = dedupe(catalog.selectedOnlyModels ?? []);
  if (![...catalog.models, ...alreadyMore].some((item) => chosen.has(item.model))) return shown;

  const models = catalog.models.filter((item) => chosen.has(item.model));
  const demoted = catalog.models.filter((item) => !chosen.has(item.model));
  const more = dedupe([...alreadyMore, ...demoted]);
  return {
    ...shown,
    models,
    selectedOnlyModels: mode === "more" ? more : currentOnlyList(more, chosen),
  };
}
