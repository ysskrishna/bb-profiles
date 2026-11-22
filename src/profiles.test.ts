import { describe, expect, it } from "vitest";
import {
  ProfileError,
  createProfile,
  deleteProfile,
  parseSnapshot,
  renameProfile,
  resolveProfile,
  setDefaultModel,
  setProfileProjects,
  setProvider,
  type Snapshot,
} from "./profiles";
import { limit, off, snapshotOf } from "./test-utils";

describe("snapshot validation", () => {
  const valid = snapshotOf({ a: limit("m") });
  it("accepts a valid snapshot and rejects broken invariants", () => {
    expect(parseSnapshot(valid)).toEqual(valid);
    const dup = (profiles: unknown[]) => ({ ...valid, profiles });
    const named = (id: string, name: string, projectIds: string[] = []) => ({
      id,
      name,
      projectIds,
      providers: {},
    });
    expect(() => parseSnapshot(dup([named("x", "Default")]))).toThrow();
    expect(() => parseSnapshot(dup([valid.profiles[0], named("p", "A"), named("q", "a")]))).toThrow(/unique/);
    expect(() => parseSnapshot(dup([valid.profiles[0], named("p", "A", ["1"]), named("q", "B", ["1"])]))).toThrow(
      /one profile/,
    );
    expect(() => parseSnapshot({ ...valid, hiddenModels: "nope" })).toThrow();
    expect(() => parseSnapshot(snapshotOf({ a: { enabled: true, limit: true, modelIds: [] } }))).toThrow(
      /at least one/,
    );
  });
});

describe("profile operations", () => {
  const base = (): Snapshot =>
    snapshotOf({ alpha: limit("a", "b") }, { defaultModel: { providerId: "alpha", model: "a" } });
  it("copies a profile deeply so the copy is independent", () => {
    const { snapshot, id } = createProfile(base(), "  Work ", "default", "p1");
    const copy = snapshot.profiles.find((p) => p.id === id)!;
    expect(copy).toMatchObject({ name: "Work", projectIds: [] });
    expect(copy.providers).toEqual(snapshot.profiles[0].providers);
    expect(copy.providers.alpha).not.toBe(snapshot.profiles[0].providers.alpha);
    const changed = setProvider(snapshot, "p1", "alpha", limit("b"));
    expect(changed.profiles[0].providers.alpha.modelIds).toEqual(["a", "b"]);
    expect(changed.profiles[1].providers.alpha.modelIds).toEqual(["b"]);
    expect(copy.defaultModel).toEqual({ providerId: "alpha", model: "a" });
  });
  it("keeps names unique ignoring case, and Default fixed", () => {
    const { snapshot } = createProfile(base(), "Work", "default", "p1");
    expect(() => createProfile(snapshot, "work", "default", "p2")).toThrow(ProfileError);
    expect(() => createProfile(snapshot, "default", "default", "p2")).toThrow(/exists/);
    expect(() => createProfile(snapshot, "   ", "default", "p2")).toThrow(ProfileError);
    expect(() => renameProfile(snapshot, "default", "Other")).toThrow(/renamed/);
    expect(() => deleteProfile(snapshot, "default")).toThrow(/deleted/);
    expect(() => setProfileProjects(snapshot, "default", ["x"])).toThrow(ProfileError);
    expect(renameProfile(snapshot, "p1", "WORK").profiles[1].name).toBe("WORK");
  });
  it("moves projects out of other profiles, and deleting returns them to Default", () => {
    let s = createProfile(base(), "A", "default", "pa").snapshot;
    s = createProfile(s, "B", "default", "pb").snapshot;
    s = setProfileProjects(s, "pa", ["p1", "p2", "p1"]);
    s = setProfileProjects(s, "pb", ["p2", "p3"]);
    expect(s.profiles.find((p) => p.id === "pa")!.projectIds).toEqual(["p1"]);
    expect(s.profiles.find((p) => p.id === "pb")!.projectIds).toEqual(["p2", "p3"]);
    expect(resolveProfile(s, "p2").id).toBe("pb");
    s = deleteProfile(s, "pb");
    expect(resolveProfile(s, "p2").id).toBe("default");
    expect(resolveProfile(s, "p1").id).toBe("pa");
    expect(resolveProfile(s, null).id).toBe("default");
    expect(() => parseSnapshot(s)).not.toThrow();
  });
  it("clears a default model that its provider rule would hide", () => {
    const off1 = setProvider(base(), "default", "alpha", off);
    expect(off1.profiles[0].defaultModel).toBeUndefined();
    const other = setProvider(base(), "default", "alpha", limit("b"));
    expect(other.profiles[0].defaultModel).toBeUndefined();
    const kept = setProvider(base(), "default", "alpha", limit("a"));
    expect(kept.profiles[0].defaultModel).toBeDefined();
    expect(() => setDefaultModel(base(), "default", { providerId: "alpha", model: "zzz" })).toThrow(/hidden/);
    expect(setDefaultModel(base(), "default", null).profiles[0].defaultModel).toBeUndefined();
  });
});
