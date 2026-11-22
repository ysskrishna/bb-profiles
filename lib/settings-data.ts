import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";

export interface ProviderOption {
  id: string;
  displayName: string;
}
export interface ProjectOption {
  id: string;
  name: string;
}
export interface ModelOption {
  model: string;
  displayName: string;
  efforts: string[];
}
export interface CustomModelOption {
  providerId: string;
  model: string;
  displayName?: string;
}
export type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; models: ModelOption[] };

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function useProviders(): {
  providers: ProviderOption[];
  error: string | null;
} {
  const sdk = useSdk();
  const [state, setState] = useState<{
    providers: ProviderOption[];
    error: string | null;
  }>({ providers: [], error: null });
  useEffect(() => {
    let live = true;
    sdk.providers.list().then(
      (rows) => {
        if (live)
          setState({
            providers: rows.map((p) => ({
              id: p.id,
              displayName: p.displayName || p.id,
            })),
            error: null,
          });
      },
      (cause) => {
        if (live) setState({ providers: [], error: describe(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [sdk]);
  return state;
}

export function useProjects(): ProjectOption[] {
  const sdk = useSdk();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  useEffect(() => {
    let live = true;
    sdk.projects.list().then(
      (rows) => {
        if (live) setProjects(rows.filter((p) => p.kind !== "personal").map((p) => ({ id: p.id, name: p.name })));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [sdk]);
  return projects;
}

/** Raw catalogs, loaded once per provider (not through the picker projection). */
export function useCatalogs(
  providerIds: readonly string[],
  /** Bump to reload every catalog, for example after custom models change. */
  version = 0,
): Record<string, CatalogState> {
  const sdk = useSdk();
  const [catalogs, setCatalogs] = useState<Record<string, CatalogState>>({});
  const key = providerIds.join("\n");
  useEffect(() => {
    let live = true;
    for (const providerId of key ? key.split("\n") : []) {
      setCatalogs((now) => (now[providerId] ? now : { ...now, [providerId]: { status: "loading" } }));
      sdk.system.executionOptions({ providerId }).then(
        (data) => {
          if (!live) return;
          const seen = new Set<string>();
          const models = [...data.models, ...data.selectedOnlyModels]
            .filter((m) => !seen.has(m.model) && Boolean(seen.add(m.model)))
            .map((m) => ({
              model: m.model,
              displayName: m.displayName || m.model,
              efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
            }));
          const next: CatalogState = data.modelLoadError
            ? {
                status: "error",
                message: data.modelLoadError.detail ?? "Could not load this provider's models.",
              }
            : { status: "ready", models };
          setCatalogs((now) => ({ ...now, [providerId]: next }));
        },
        (cause) => {
          if (live)
            setCatalogs((now) => ({
              ...now,
              [providerId]: { status: "error", message: describe(cause) },
            }));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [sdk, key, version]);
  return catalogs;
}
