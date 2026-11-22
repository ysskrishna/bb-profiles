// The settings page's building blocks, shared with Idle Compact and Thread Inbox and drawn
// after BB's own settings: a short section title over a bordered card, and
// rows with the label on the left and the control on the right.
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";

export type SaveStatus = "saving" | "saved" | "error";

function sectionId(title: string): string {
  return `profiles-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function SettingsSection({
  title,
  status,
  children,
}: {
  title: string;
  /** Save feedback for the change just made in this section. */
  status?: SaveStatus;
  children: ReactNode;
}) {
  const id = sectionId(title);
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-sm font-medium text-foreground">
          {title}
        </h2>
        <SaveIndicator status={status} />
      </div>
      <div className="rounded-lg border border-border bg-card py-1.5">{children}</div>
    </section>
  );
}

/**
 * "Saving...", then "Saved", beside the section that changed. The last label
 * stays in place while it fades, so the heading row never jumps.
 */
function SaveIndicator({ status }: { status: SaveStatus | undefined }) {
  const [shown, setShown] = useState(status);
  useEffect(() => {
    if (status) setShown(status);
  }, [status]);
  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-1 text-xs transition-opacity duration-300 motion-reduce:transition-none",
        status ? "opacity-100" : "opacity-0",
        shown === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {shown === "saving" ? (
        "Saving..."
      ) : shown === "saved" ? (
        <>
          <Icon name="Check" aria-hidden className="size-3.5 text-success" />
          Saved
        </>
      ) : shown === "error" ? (
        <>
          <Icon name="CircleX" aria-hidden className="size-3.5" />
          Not saved
        </>
      ) : null}
    </span>
  );
}

/**
 * One setting. `control` sits on the right; `children` render below the
 * label at full width, for a dependent value.
 */
export function SettingRow({
  title,
  description,
  control,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm text-foreground">{title}</p>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

/** A setting turned on and off by a switch, which the row's title names. */
export function SwitchRow({
  checked,
  disabled,
  onChange,
  ...row
}: Omit<ComponentProps<typeof SettingRow>, "title" | "control"> & {
  title: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow
      {...row}
      control={<Switch label={row.title} checked={checked} disabled={disabled} onChange={onChange} />}
    />
  );
}

/**
 * A native select, kept for its keyboard and screen-reader behaviour, styled
 * like BB's dropdown buttons. `className` sizes the wrapper.
 */
export function SettingsSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-44", className)}>
      <select
        {...props}
        className="h-8 w-full appearance-none truncate rounded-md border border-border bg-background pl-2.5 pr-7 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Icon
        name="ChevronDown"
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
