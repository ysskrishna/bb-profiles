// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_SNAPSHOT,
  createProfile,
  deleteProfile,
  renameProfile,
  setDefaultModel,
  setHiddenModels,
  setProfileProjects,
  setProvider,
  type Snapshot,
} from "./profiles";

const state = vi.hoisted(() => {
  const model = (id: string, efforts: string[] = []) => ({
    model: id,
    displayName: id.toUpperCase(),
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
    })),
  });
  return {
    snapshot: null as unknown as Snapshot,
    custom: [] as { providerId: string; model: string; displayName?: string }[],
    calls: [] as [string, unknown][],
    handlers: {} as Record<string, (input: any) => unknown>,
    rpc: {
      call: null as unknown as (m: string, i: unknown) => Promise<unknown>,
    },
    sdk: {
      providers: {
        list: async () => [
          { id: "alpha", displayName: "Alpha", available: true },
          { id: "beta", displayName: "Beta", available: true },
        ],
      },
      projects: {
        list: async () => [
          { id: "p1", name: "Aribills", kind: "standard" },
          { id: "p2", name: "Snabbit", kind: "standard" },
          { id: "me", name: "Personal", kind: "personal" },
        ],
      },
      system: {
        executionOptions: async ({ providerId }: { providerId: string }) => ({
          providers: [],
          models:
            providerId === "alpha"
              ? [
                  model("a1", ["low", "high"]),
                  model("a2"),
                  model("a3"),
                  ...state.custom.filter((c) => c.providerId === "alpha").map((c) => model(c.model)),
                ]
              : [model("b1")],
          selectedOnlyModels: [],
          modelLoadError: null,
        }),
      },
    },
  };
});
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => state.rpc,
  useSdk: () => state.sdk,
  useRealtime: () => {},
  experimental_Icon: () => null,
}));
import { SettingsPage } from "./SettingsPage";
import { receiveSnapshot } from "../lib/profiles-client";

let revision = 5000;
function install() {
  const commit = (next: Snapshot) => {
    revision += 1;
    state.snapshot = { ...next, revision };
    return state.snapshot;
  };
  state.handlers = {
    getSnapshot: () => state.snapshot,
    setHiddenModels: ({ mode }) => commit(setHiddenModels(state.snapshot, mode)),
    createProfile: ({ name, copyFromId }) => {
      const made = createProfile(state.snapshot, name, copyFromId, `p_${name}`);
      return { snapshot: commit(made.snapshot), id: made.id };
    },
    renameProfile: ({ id, name }) => commit(renameProfile(state.snapshot, id, name)),
    deleteProfile: ({ id }) => commit(deleteProfile(state.snapshot, id)),
    setProfileProjects: ({ id, projectIds }) => commit(setProfileProjects(state.snapshot, id, projectIds)),
    setProvider: ({ profileId, providerId, rule }) => commit(setProvider(state.snapshot, profileId, providerId, rule)),
    setDefaultModel: ({ profileId, defaultModel }) => commit(setDefaultModel(state.snapshot, profileId, defaultModel)),
    reset: () => commit(INITIAL_SNAPSHOT),
    listCustomModels: () => ({ models: state.custom }),
    addCustomModel: (input) => {
      if (state.custom.some((c) => c.model === input.model)) throw new Error("HTTP 400: Already a custom model");
      state.custom = [...state.custom, input];
      return { models: state.custom };
    },
    removeCustomModel: ({ providerId, model }) => {
      state.custom = state.custom.filter((c) => !(c.providerId === providerId && c.model === model));
      return { models: state.custom, warning: "BB could not reload" };
    },
  };
  state.rpc.call = async (method, input) => {
    state.calls.push([method, input]);
    const result = state.handlers[method](input);
    return result;
  };
}
beforeEach(() => {
  state.calls = [];
  state.custom = [];
  revision += 10;
  state.snapshot = { ...INITIAL_SNAPSHOT, revision };
  receiveSnapshot(state.snapshot);
  install();
});
afterEach(cleanup);

const called = (method: string) => state.calls.filter(([m]) => m === method);
async function ready() {
  render(<SettingsPage />);
  await screen.findByRole("heading", { name: 'Providers in "Default"' });
}
async function createWork(name = "Work") {
  fireEvent.click(screen.getByRole("button", { name: "New profile" }));
  fireEvent.change(screen.getByLabelText("New profile name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("heading", { name: `Providers in "${name}"` });
}

describe("settings page", () => {
  it("shows the three sections without apply buttons", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "Profiles" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Everywhere" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply|discard/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Default All other/ }).textContent).toContain("All other projects");
    expect(screen.queryByText("Projects")).toBeNull();
  });

  it("creates a profile as a copy, assigns a project and sets its default model", async () => {
    await ready();
    await createWork();
    expect(called("createProfile")[0][1]).toEqual({
      name: "Work",
      copyFromId: "default",
    });
    expect(screen.queryByText("Personal")).toBeNull();
    const projects = await screen.findByRole("list", { name: "Projects" });
    fireEvent.click(within(projects).getByRole("checkbox", { name: "Aribills" }));
    await waitFor(() =>
      expect(called("setProfileProjects")[0][1]).toEqual({
        id: "p_Work",
        projectIds: ["p1"],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Work Aribills/ }).textContent).toContain("Aribills"),
    );
    const select = await screen.findByLabelText("Default model");
    await waitFor(() => expect(within(select).queryByText("A1")).toBeTruthy());
    fireEvent.change(select, {
      target: { value: JSON.stringify(["alpha", "a1"]) },
    });
    await waitFor(() =>
      expect(called("setDefaultModel")[0][1]).toEqual({
        profileId: "p_Work",
        defaultModel: { providerId: "alpha", model: "a1" },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Default reasoning"), {
      target: { value: "high" },
    });
    await waitFor(() =>
      expect(called("setDefaultModel")[1][1]).toEqual({
        profileId: "p_Work",
        defaultModel: {
          providerId: "alpha",
          model: "a1",
          reasoningLevel: "high",
        },
      }),
    );
  });

  it("moves a project out of the profile that owned it", async () => {
    await ready();
    await createWork("A");
    fireEvent.click(
      within(await screen.findByRole("list", { name: "Projects" })).getByRole("checkbox", { name: "Aribills" }),
    );
    await waitFor(() => expect(state.snapshot.profiles[1].projectIds).toEqual(["p1"]));
    await createWork("B");
    fireEvent.click(
      within(await screen.findByRole("list", { name: "Projects" })).getByRole("checkbox", { name: /Aribills/ }),
    );
    await waitFor(() => expect(state.snapshot.profiles[2].projectIds).toEqual(["p1"]));
    expect(state.snapshot.profiles[1].projectIds).toEqual([]);
  });

  it("limits to selected models, preselecting all, and keeps the last one checked", async () => {
    await ready();
    const limitSwitch = await screen.findByRole("switch", {
      name: "Limit to selected models",
    });
    await waitFor(() => expect(limitSwitch.hasAttribute("disabled")).toBe(false));
    fireEvent.click(limitSwitch);
    await waitFor(() =>
      expect(called("setProvider")[0][1]).toEqual({
        profileId: "default",
        providerId: "alpha",
        rule: { enabled: true, limit: true, modelIds: ["a1", "a2", "a3"] },
      }),
    );
    const list = await screen.findByRole("list", { name: "Alpha models" });
    expect(screen.getByText(/3 of 3 selected/)).toBeTruthy();
    fireEvent.click(within(list).getByRole("checkbox", { name: /A2/ }));
    await waitFor(() => expect(screen.getByText(/2 of 3 selected/)).toBeTruthy());
    fireEvent.click(within(list).getByRole("checkbox", { name: /A3/ }));
    await waitFor(() => expect(screen.getByText(/1 of 3 selected/)).toBeTruthy());
    expect(within(list).getByRole("checkbox", { name: /A1/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Search Alpha models"), {
      target: { value: "a3" },
    });
    expect(within(list).queryByText("A1")).toBeNull();
  });

  it("turns a provider off and marks its tab", async () => {
    await ready();
    fireEvent.click(await screen.findByRole("switch", { name: "Use Alpha" }));
    await waitFor(() => expect(within(screen.getByRole("tab", { name: /Alpha/ })).queryByText("Off")).toBeTruthy());
    expect(screen.queryByRole("switch", { name: "Limit to selected models" })).toBeNull();
  });

  it("lists unavailable saved models and lets them be removed", async () => {
    await ready();
    state.snapshot = setProvider(state.snapshot, "default", "alpha", {
      enabled: true,
      limit: true,
      modelIds: ["a1", "gone"],
    });
    receiveSnapshot({ ...state.snapshot, revision: ++revision });
    state.snapshot = { ...state.snapshot, revision };
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(state.snapshot.profiles[0].providers.alpha.modelIds).toEqual(["a1"]));
  });

  it("renames after a pause and deletes after confirming", async () => {
    await ready();
    await createWork();
    fireEvent.click(screen.getByRole("button", { name: "Work actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Profile name"), {
      target: { value: "Client" },
    });
    expect(called("renameProfile")).toHaveLength(0);
    await waitFor(() => expect(called("renameProfile")).toHaveLength(1), {
      timeout: 2000,
    });
    expect(called("renameProfile")[0][1]).toEqual({
      id: "p_Work",
      name: "Client",
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Client actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(called("deleteProfile")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("heading", { name: 'Providers in "Default"' });
    expect(called("deleteProfile")[0][1]).toEqual({ id: "p_Work" });
  });

  it("saves a rename right away when Done is clicked before the pause", async () => {
    await ready();
    await createWork();
    fireEvent.click(screen.getByRole("button", { name: "Work actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Profile name"), {
      target: { value: "Client" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(called("renameProfile")).toHaveLength(1));
    expect(called("renameProfile")[0][1]).toEqual({
      id: "p_Work",
      name: "Client",
    });
  });

  it("offers only Duplicate for Default, and shows a server refusal inline", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Default actions" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Duplicate"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect((screen.getByLabelText("Copy from") as HTMLSelectElement).value).toBe("default");
    fireEvent.change(screen.getByLabelText("New profile name"), {
      target: { value: "default" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/exists/);
    expect(screen.getByRole("heading", { name: 'Providers in "Default"' })).toBeTruthy();
  });

  it("saves the hidden-models choice and resets everything after confirming", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Hidden models"), {
      target: { value: "remove" },
    });
    await waitFor(() => expect(called("setHiddenModels")[0][1]).toEqual({ mode: "remove" }));
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    expect(called("reset")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(called("reset")).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText("Hidden models") as HTMLSelectElement).value).toBe("more"));
  });

  it("adds a custom model, refreshes the catalog and selects it when Limit is on", async () => {
    await ready();
    const limitSwitch = await screen.findByRole("switch", {
      name: "Limit to selected models",
    });
    await waitFor(() => expect(limitSwitch.hasAttribute("disabled")).toBe(false));
    fireEvent.click(limitSwitch);
    const list = await screen.findByRole("list", { name: "Alpha models" });
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "a-new" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: " New one " },
    });
    fireEvent.submit(screen.getByLabelText("Model ID").closest("form")!);
    await waitFor(() =>
      expect(called("addCustomModel")[0][1]).toEqual({
        providerId: "alpha",
        model: "a-new",
        displayName: "New one",
      }),
    );
    await waitFor(() => expect(within(list).queryByRole("checkbox", { name: /A-NEW/ })).toBeTruthy());
    await waitFor(() => expect(state.snapshot.profiles[0].providers.alpha.modelIds).toContain("a-new"));
    expect(
      (
        within(list).getByRole("checkbox", {
          name: /A-NEW/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect((screen.getByLabelText("Model ID") as HTMLInputElement).value).toBe("");
    expect(within(screen.getByRole("list", { name: "Alpha custom models" })).getByText("New one")).toBeTruthy();
  });

  it("does not change the profile when Limit is off", async () => {
    await ready();
    await screen.findByRole("switch", { name: "Limit to selected models" });
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "a-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    await waitFor(() => expect(called("addCustomModel")).toHaveLength(1));
    await screen.findByText("Saved");
    expect(called("addCustomModel")[0][1]).toEqual({
      providerId: "alpha",
      model: "a-new",
    });
    // undefined is not a JSON value, so the RPC refuses a present-but-empty key.
    expect(called("addCustomModel")[0][1]).not.toHaveProperty("displayName");
    expect(called("setProvider")).toHaveLength(0);
  });

  it("removes a custom model and shows the reload warning", async () => {
    state.custom = [{ providerId: "alpha", model: "a-x", displayName: "Ax" }];
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Remove custom model a-x" }));
    await waitFor(() =>
      expect(called("removeCustomModel")[0][1]).toEqual({
        providerId: "alpha",
        model: "a-x",
      }),
    );
    expect(await screen.findByText("BB could not reload")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Alpha custom models" })).toBeNull();
  });

  it("shows a refused add inline and keeps the typed ID", async () => {
    state.custom = [{ providerId: "beta", model: "dup" }];
    await ready();
    await screen.findByRole("switch", { name: "Limit to selected models" });
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "dup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Already a custom model/);
    expect((screen.getByLabelText("Model ID") as HTMLInputElement).value).toBe("dup");
  });
});
