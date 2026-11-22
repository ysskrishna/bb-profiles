import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { DEFAULT_PROFILE_ID, getProviderRule, type DefaultModel, type Profile, type Snapshot } from "./profiles";
import type { CatalogState, ProjectOption, ProviderOption } from "../lib/settings-data";
import { SettingRow, SettingsSection, SettingsSelect, type SaveStatus } from "./settings-ui";
import { cn } from "../lib/utils";

const RENAME_DELAY_MS = 500;
type Editor = { kind: "new"; copyFromId: string; name: string } | { kind: "rename"; name: string } | { kind: "delete" };

export interface ProfileActions {
  create(name: string, copyFromId: string): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  setProjects(id: string, projectIds: string[]): void;
  setDefaultModel(id: string, model: DefaultModel | null): void;
}

const NONE = "";
const encode = (providerId: string, model: string) => JSON.stringify([providerId, model]);

export function ProfilesSection({
  snapshot,
  selected,
  onSelect,
  projects,
  providers,
  catalogs,
  status,
  error,
  actions,
}: {
  snapshot: Snapshot;
  selected: Profile;
  onSelect: (id: string) => void;
  projects: ProjectOption[];
  providers: ProviderOption[];
  catalogs: Record<string, CatalogState>;
  status: SaveStatus | undefined;
  error: string | null;
  actions: ProfileActions;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const isDefault = selected.id === DEFAULT_PROFILE_ID;
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  // A rename saves once typing pauses, like the rest of the page.
  const renameName = editor?.kind === "rename" ? editor.name : null;
  useEffect(() => {
    if (renameName === null) return;
    const clean = renameName.trim();
    if (!clean || clean === selected.name) return;
    const timer = setTimeout(() => void actions.rename(selected.id, clean), RENAME_DELAY_MS);
    return () => clearTimeout(timer);
    // actions identity changes every render; the inputs are listed.
  }, [renameName, selected.id, selected.name]);
  useEffect(() => setEditor(null), [selected.id]);
  // Done and Enter save right away instead of waiting for the pause, which
  // closing the editor would otherwise cancel.
  const finishRename = (name: string) => {
    const clean = name.trim();
    setEditor(null);
    if (clean && clean !== selected.name) void actions.rename(selected.id, clean);
  };

  return (
    <SettingsSection title="Profiles" status={status}>
      {error ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        {snapshot.profiles.map((profile) => {
          const names =
            profile.id === DEFAULT_PROFILE_ID ? "All other projects" : profile.projectIds.map(projectName).join(", ");
          return (
            <button
              key={profile.id}
              type="button"
              aria-pressed={profile.id === selected.id}
              onClick={() => onSelect(profile.id)}
              className={cn(
                "inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                profile.id === selected.id
                  ? "border-ring bg-state-active text-foreground"
                  : "border-border text-foreground hover:bg-state-hover",
              )}
            >
              <span className="truncate">{profile.name}</span>
              {names ? <span className="truncate text-xs text-muted-foreground">{names}</span> : null}
            </button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditor({ kind: "new", copyFromId: selected.id, name: "" })}
        >
          <Icon name="Plus" aria-hidden />
          New profile
        </Button>
        <ProfileMenu
          profile={selected}
          onDuplicate={() => setEditor({ kind: "new", copyFromId: selected.id, name: "" })}
          onRename={() => setEditor({ kind: "rename", name: selected.name })}
          onDelete={() => setEditor({ kind: "delete" })}
        />
      </div>

      {editor?.kind === "new" ? (
        <NewProfileRow
          snapshot={snapshot}
          editor={editor}
          onChange={setEditor}
          onCreate={async () => {
            if (await actions.create(editor.name, editor.copyFromId)) setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {editor?.kind === "rename" ? (
        <SettingRow
          title="Rename"
          control={
            <div className="flex items-center gap-2">
              <input
                autoFocus
                aria-label="Profile name"
                maxLength={60}
                value={editor.name}
                onChange={(event) => setEditor({ kind: "rename", name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishRename(editor.name);
                  }
                }}
                className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => finishRename(editor.name)}>
                Done
              </Button>
            </div>
          }
        />
      ) : null}
      {editor?.kind === "delete" ? (
        <SettingRow
          title={`Delete "${selected.name}"?`}
          description="Its projects go back to Default."
          control={
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (await actions.remove(selected.id)) setEditor(null);
                }}
              >
                Delete
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditor(null)}>
                Cancel
              </Button>
            </div>
          }
        />
      ) : null}

      {isDefault ? null : (
        <SettingRow title="Projects" description="New threads in these projects use this profile.">
          <ProjectChecklist
            profile={selected}
            snapshot={snapshot}
            projects={projects}
            onChange={(ids) => actions.setProjects(selected.id, ids)}
          />
        </SettingRow>
      )}
      <DefaultModelRow
        profile={selected}
        providers={providers}
        catalogs={catalogs}
        onChange={(model) => actions.setDefaultModel(selected.id, model)}
      />
    </SettingsSection>
  );
}

function ProfileMenu({
  profile,
  onDuplicate,
  onRename,
  onDelete,
}: {
  profile: Profile;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const items = [
    { label: "Duplicate", run: onDuplicate },
    ...(profile.id === DEFAULT_PROFILE_ID
      ? []
      : [
          { label: "Rename", run: onRename },
          { label: "Delete", run: onDelete, destructive: true },
        ]),
  ];
  return (
    <div ref={root} className="relative ml-auto">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${profile.name} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((now) => !now)}
      >
        <Icon name="MoreHorizontal" aria-hidden />
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-36 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
              className={cn(
                "block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none",
                "destructive" in item && item.destructive ? "text-destructive" : "text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewProfileRow({
  snapshot,
  editor,
  onChange,
  onCreate,
  onCancel,
}: {
  snapshot: Snapshot;
  editor: Extract<Editor, { kind: "new" }>;
  onChange: (editor: Editor) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const clean = editor.name.trim();
  return (
    <SettingRow
      title="New profile"
      description="Starts as a copy, then changes on its own."
      control={
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (clean) onCreate();
          }}
        >
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Copy from
            <SettingsSelect
              aria-label="Copy from"
              className="w-36"
              value={editor.copyFromId}
              onChange={(event) => onChange({ ...editor, copyFromId: event.target.value })}
            >
              {snapshot.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </SettingsSelect>
          </label>
          <input
            autoFocus
            aria-label="New profile name"
            placeholder="Name"
            maxLength={60}
            value={editor.name}
            onChange={(event) => onChange({ ...editor, name: event.target.value })}
            className="h-8 w-40 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!clean}>
            Create
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </form>
      }
    />
  );
}

function ProjectChecklist({
  profile,
  snapshot,
  projects,
  onChange,
}: {
  profile: Profile;
  snapshot: Snapshot;
  projects: ProjectOption[];
  onChange: (ids: string[]) => void;
}) {
  const owner = (projectId: string) =>
    snapshot.profiles.find((item) => item.id !== profile.id && item.projectIds.includes(projectId));
  // Assigned projects the project list no longer returns stay visible so they
  // can be removed.
  const missing = profile.projectIds.filter((id) => !projects.some((p) => p.id === id));
  const rows = [...projects, ...missing.map((id) => ({ id, name: id }))];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No projects yet.</p>;
  return (
    <ul aria-label="Projects" className="max-h-56 overflow-y-auto rounded-md border border-border">
      {rows.map((project) => {
        const checked = profile.projectIds.includes(project.id);
        const other = owner(project.id);
        return (
          <li key={project.id} className="border-b border-border last:border-b-0">
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...profile.projectIds, project.id]
                      : profile.projectIds.filter((id) => id !== project.id),
                  )
                }
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 truncate">{project.name}</span>
              {other ? <span className="ml-auto truncate text-xs text-muted-foreground">In {other.name}</span> : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function DefaultModelRow({
  profile,
  providers,
  catalogs,
  onChange,
}: {
  profile: Profile;
  providers: ProviderOption[];
  catalogs: Record<string, CatalogState>;
  onChange: (model: DefaultModel | null) => void;
}) {
  const current = profile.defaultModel;
  const groups = providers
    .filter((p) => getProviderRule(profile, p.id)?.enabled !== false)
    .map((provider) => {
      const catalog = catalogs[provider.id];
      const rule = getProviderRule(profile, provider.id);
      const models =
        catalog?.status === "ready"
          ? catalog.models.filter((m) => !rule?.limit || rule.modelIds.includes(m.model))
          : [];
      return { provider, models };
    })
    .filter((group) => group.models.length > 0);
  const value = current ? encode(current.providerId, current.model) : NONE;
  const listed = groups.some((g) => g.models.some((m) => encode(g.provider.id, m.model) === value));
  const efforts =
    groups.find((g) => g.provider.id === current?.providerId)?.models.find((m) => m.model === current?.model)
      ?.efforts ?? [];
  return (
    <SettingRow
      title="Default model"
      description="Selected when you start a new thread, unless you pick another."
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SettingsSelect
            aria-label="Default model"
            className="w-56"
            value={value}
            onChange={(event) => {
              if (event.target.value === NONE) return onChange(null);
              const [providerId, model] = JSON.parse(event.target.value) as [string, string];
              onChange({ providerId, model });
            }}
          >
            <option value={NONE}>None</option>
            {current && !listed ? <option value={value}>{`${current.providerId} / ${current.model}`}</option> : null}
            {groups.map((group) => (
              <optgroup key={group.provider.id} label={group.provider.displayName}>
                {group.models.map((m) => (
                  <option key={m.model} value={encode(group.provider.id, m.model)}>
                    {m.displayName}
                  </option>
                ))}
              </optgroup>
            ))}
          </SettingsSelect>
          {current && efforts.length > 0 ? (
            <SettingsSelect
              aria-label="Default reasoning"
              className="w-28"
              value={current.reasoningLevel ?? ""}
              onChange={(event) =>
                onChange({
                  providerId: current.providerId,
                  model: current.model,
                  ...(event.target.value ? { reasoningLevel: event.target.value } : {}),
                })
              }
            >
              <option value="">Auto</option>
              {efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort.charAt(0).toUpperCase() + effort.slice(1)}
                </option>
              ))}
            </SettingsSelect>
          ) : null}
        </div>
      }
    />
  );
}
