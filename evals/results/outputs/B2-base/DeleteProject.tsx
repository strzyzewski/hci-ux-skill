/**
 * DeleteProject — delete flow for a Project.
 *
 * Assumptions (no one to ask):
 * - Desktop, keyboard + mouse; used daily by team leads, so friction must scale with risk.
 * - Deletion is permanent and cascades to tasks/files/members (server-side).
 * - Archive is the reversible alternative and is offered inside the dialog.
 * - Parent supplies project {id, name, archived} and handles navigation/toasts via callbacks.
 * - Empty projects (0 dependents) are low-risk: a plain confirm, no typing.
 *   Projects with dependents require typing the exact project name.
 * - Auth/CSRF is handled by the app's fetch layer (cookies); errors return non-2xx.
 * - Styles are inline/minimal; swap for the app's design system.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ProjectRef {
  id: string;
  name: string;
  archived?: boolean;
}

interface Dependencies {
  tasks: number;
  files: number;
  members: number;
}

interface Props {
  project: ProjectRef;
  /** Called after permanent deletion succeeds (e.g. navigate to project list). */
  onDeleted: (project: ProjectRef) => void;
  /** Called after archive/unarchive succeeds. */
  onArchiveChanged?: (project: ProjectRef, archived: boolean) => void;
  /** Optional custom trigger; defaults to a "Delete project…" button. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deps: Dependencies };

const plural = (n: number, one: string, many = one + "s") =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

async function api(path: string, init?: RequestInit, signal?: AbortSignal) {
  const res = await fetch(path, { ...init, signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

export function DeleteProject({
  project,
  onDeleted,
  onArchiveChanged,
  renderTrigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to where the user came from.
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const openDialog = () => setOpen(true);

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openDialog)
      ) : (
        <button ref={triggerRef} type="button" onClick={openDialog}>
          Delete project…
        </button>
      )}
      {open && (
        <DeleteDialog
          project={project}
          onClose={close}
          onDeleted={onDeleted}
          onArchiveChanged={onArchiveChanged}
        />
      )}
    </>
  );
}

function DeleteDialog({
  project,
  onClose,
  onDeleted,
  onArchiveChanged,
}: {
  project: ProjectRef;
  onClose: () => void;
  onDeleted: (p: ProjectRef) => void;
  onArchiveChanged?: (p: ProjectRef, archived: boolean) => void;
}) {
  const titleId = useId();
  const descId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<null | "delete" | "archive">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch dependency counts fresh each time the dialog opens (they change).
  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ status: "loading" });
    api(`/api/projects/${encodeURIComponent(project.id)}/dependencies`, undefined, ctrl.signal)
      .then((r) => r.json() as Promise<Dependencies>)
      .then((deps) => setLoad({ status: "ready", deps }))
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setLoad({ status: "error", message: "Couldn't check what this project contains." });
      });
    return () => ctrl.abort();
  }, [project.id, reloadKey]);

  const deps = load.status === "ready" ? load.deps : null;
  const total = deps ? deps.tasks + deps.files + deps.members : 0;
  const needsTyping = total > 0;
  const nameMatches = typed.trim() === project.name.trim();
  const canDelete =
    load.status === "ready" && busy === null && (!needsTyping || nameMatches);

  // Safe default focus: Cancel. Once we know typing is needed, focus the input.
  useEffect(() => {
    if (load.status === "ready" && needsTyping) inputRef.current?.focus();
    else cancelRef.current?.focus();
  }, [load.status, needsTyping]);

  // Escape closes (unless mid-request); Tab is trapped inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy === null) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const f = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, input, [href], [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !(el as HTMLButtonElement).disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const doDelete = async () => {
    if (!canDelete) return;
    setBusy("delete");
    setActionError(null);
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      onDeleted(project);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) {
        // Already gone (e.g. deleted by another lead): the goal is achieved.
        onDeleted(project);
        return;
      }
      setBusy(null);
      setActionError(
        status === 403
          ? "You don't have permission to delete this project. Nothing was deleted."
          : "Couldn't delete the project. Nothing was deleted — please try again."
      );
    }
  };

  const doArchiveToggle = async () => {
    if (busy) return;
    const willArchive = !project.archived;
    setBusy("archive");
    setActionError(null);
    try {
      await api(
        `/api/projects/${encodeURIComponent(project.id)}/${willArchive ? "archive" : "unarchive"}`,
        { method: "POST" }
      );
      onArchiveChanged?.(project, willArchive);
      onClose();
    } catch {
      setBusy(null);
      setActionError(`Couldn't ${willArchive ? "archive" : "unarchive"} the project. Please try again.`);
    }
  };

  const summary = deps
    ? [
        deps.tasks > 0 && plural(deps.tasks, "task"),
        deps.files > 0 && plural(deps.files, "file"),
        deps.members > 0 && plural(deps.members, "member"),
      ].filter(Boolean)
    : [];

  return (
    <div
      style={S.backdrop}
      // Backdrop click does NOT dismiss: avoids accidental loss of typed confirmation.
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={S.dialog}
      >
        <h2 id={titleId} style={S.title}>
          Delete “{project.name}” permanently?
        </h2>

        <div id={descId} aria-live="polite">
          {load.status === "loading" && <p style={S.muted}>Checking what this project contains…</p>}

          {load.status === "error" && (
            <div role="alert" style={S.errorBox}>
              <p style={{ margin: 0 }}>{load.message} Deletion is disabled until we can show you what would be lost.</p>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={S.linkBtn}>
                Retry
              </button>
            </div>
          )}

          {deps && (
            <>
              {needsTyping ? (
                <>
                  <p style={S.p}>This will permanently delete the project and everything in it:</p>
                  <ul style={S.list}>
                    {summary.map((s) => (
                      <li key={s as string}>{s}</li>
                    ))}
                  </ul>
                  <p style={S.p}>
                    <strong>This cannot be undone.</strong> Members will lose access immediately.
                  </p>
                </>
              ) : (
                <p style={S.p}>
                  This project is empty (no tasks, files or members). Deleting it is permanent and
                  cannot be undone.
                </p>
              )}
            </>
          )}
        </div>

        {deps && needsTyping && (
          <div style={{ margin: "12px 0" }}>
            <label htmlFor={inputId} style={{ display: "block", marginBottom: 4 }}>
              Type <strong style={{ fontFamily: "monospace" }}>{project.name}</strong> to confirm
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canDelete) {
                  e.preventDefault();
                  void doDelete();
                }
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={busy !== null}
              style={S.input}
            />
          </div>
        )}

        {deps && (
          <div style={S.archiveBox}>
            <div>
              <strong>{project.archived ? "Not ready to lose it?" : "Want to keep the data?"}</strong>
              <div style={S.muted}>
                {project.archived
                  ? "Unarchive to make the project active again."
                  : "Archiving hides the project but keeps everything, and you can restore it anytime."}
              </div>
            </div>
            <button type="button" onClick={doArchiveToggle} disabled={busy !== null} style={S.btn}>
              {busy === "archive"
                ? project.archived ? "Unarchiving…" : "Archiving…"
                : project.archived ? "Unarchive instead" : "Archive instead"}
            </button>
          </div>
        )}

        {actionError && (
          <p role="alert" style={{ ...S.errorBox, margin: "12px 0 0" }}>
            {actionError}
          </p>
        )}

        <div style={S.footer}>
          <button ref={cancelRef} type="button" onClick={onClose} disabled={busy !== null} style={S.btn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={doDelete}
            disabled={!canDelete}
            aria-disabled={!canDelete}
            style={{ ...S.btn, ...S.danger, ...(canDelete ? null : S.dangerOff) }}
          >
            {busy === "delete" ? "Deleting…" : "Delete project permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  dialog: {
    background: "#fff", color: "#1a1a1a", borderRadius: 8, padding: 24,
    width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "90vh", overflow: "auto",
    boxShadow: "0 12px 40px rgba(0,0,0,.3)", font: "14px/1.5 system-ui, sans-serif",
  },
  title: { margin: "0 0 12px", fontSize: 18, wordBreak: "break-word" },
  p: { margin: "8px 0" },
  list: { margin: "4px 0 8px", paddingLeft: 20 },
  muted: { color: "#555", fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 14, border: "1px solid #888", borderRadius: 4 },
  archiveBox: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
    marginTop: 12, padding: 12, background: "#f4f6f8", borderRadius: 6,
  },
  errorBox: {
    background: "#fdecea", color: "#8a1c12", border: "1px solid #f5b5ae",
    padding: "8px 12px", borderRadius: 6, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between",
  },
  linkBtn: { background: "none", border: "none", color: "#8a1c12", textDecoration: "underline", cursor: "pointer", font: "inherit" },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 },
  btn: { padding: "8px 14px", fontSize: 14, borderRadius: 4, border: "1px solid #888", background: "#fff", cursor: "pointer" },
  danger: { background: "#b42318", borderColor: "#b42318", color: "#fff" },
  dangerOff: { opacity: 0.45, cursor: "not-allowed" },
};

export default DeleteProject;
