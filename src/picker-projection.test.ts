import { describe, expect, it } from "vitest";
import { projectCatalog } from "./picker-projection";
import { limit, off, profile } from "./test-utils";

const data = {
  providers: [{ id: "alpha" }, { id: "beta" }],
  models: [{ model: "a" }, { model: "b" }, { model: "c" }],
  selectedOnlyModels: [{ model: "old" }],
};
const ids = (list: { model: string }[]) => [...list].map((m) => m.model);

describe("picker projection", () => {
  it("removes disabled providers but never the requested one", () => {
    const both = profile("default", { beta: off, alpha: off });
    expect(projectCatalog(data, both, "more", null).providers).toEqual([{ id: "alpha" }]);
    expect(projectCatalog(data, both, "more", "alpha").providers).toEqual([{ id: "alpha" }]);
    const betaOff = profile("default", { beta: off });
    expect(projectCatalog(data, betaOff, "more", "alpha").providers).toEqual([{ id: "alpha" }]);
    expect(projectCatalog(data, betaOff, "more", "beta").providers).toEqual(data.providers);
  });
  it("falls back to the first returned provider when the requested one is absent", () => {
    const p = profile("default", { alpha: limit("b") });
    expect(ids(projectCatalog(data, p, "more", "missing").models)).toEqual(["b"]);
  });
  it("leaves the catalog untouched without a limit", () => {
    const p = profile("default", { alpha: { enabled: true, limit: false, modelIds: ["a"] } });
    expect(projectCatalog(data, p, "more", "alpha")).toBe(data);
  });
  it("ignores a rule filed under a prototype-shaped provider id", () => {
    const odd = { ...data, providers: [{ id: "__proto__" }] };
    expect(projectCatalog(odd, profile("default", { alpha: limit("b") }), "more", "__proto__")).toBe(odd);
  });
  it("shows only selected models and sends the rest to More models", () => {
    const out = projectCatalog(data, profile("default", { alpha: limit("b") }), "more", "alpha");
    expect(ids(out.models)).toEqual(["b"]);
    expect(ids(out.selectedOnlyModels)).toEqual(["old", "a", "c"]);
    expect(data.models).toHaveLength(3);
  });
  it("keeps a selected model that BB already placed under More models out of the hidden pile", () => {
    const out = projectCatalog(data, profile("default", { alpha: limit("old") }), "more", "alpha");
    expect(ids(out.models)).toEqual([]);
    expect(ids(out.selectedOnlyModels)).toEqual(["old", "a", "b", "c"]);
  });
  it("removes unselected models in remove mode but keeps the current one findable", () => {
    const out = projectCatalog(data, profile("default", { alpha: limit("b") }), "remove", "alpha");
    expect(ids(out.models)).toEqual(["b"]);
    expect(out.selectedOnlyModels.filter(() => true)).toEqual([]);
    expect(out.selectedOnlyModels.find((m) => m.model === "c")).toEqual({ model: "c", displayName: "c (Current)" });
    expect(out.selectedOnlyModels.find((m) => m.model === "old")).toEqual({
      model: "old",
      displayName: "old (Current)",
    });
    expect(out.selectedOnlyModels.find((m) => m.model === "nope")).toBeUndefined();
    // BB also reads the whole list when it resolves a model id.
    expect(ids([...out.selectedOnlyModels])).toEqual(["old", "a", "c"]);
  });
  it("still lists selected models that BB keeps under More models in remove mode", () => {
    const out = projectCatalog(data, profile("default", { alpha: limit("b", "old") }), "remove", "alpha");
    expect(ids(out.selectedOnlyModels.filter(() => true))).toEqual(["old"]);
    expect(out.selectedOnlyModels.find((m) => m.model === "old")).toBe(data.selectedOnlyModels[0]);
  });
  it("returns the catalog unchanged when no selected model exists", () => {
    const p = profile("default", { alpha: limit("gone") });
    expect(projectCatalog(data, p, "remove", "alpha")).toBe(data);
  });
});
