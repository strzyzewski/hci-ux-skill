/**
 * DeleteProject – delete flow for a project (desktop, team leads, daily use).
 *
 * ASSUMPTIONS
 * - DELETE is permanent and there is no restore endpoint, so true undo is impossible (C1: confirm
 *   only because irreversible). Deleting is rare even though the app is used daily.
 * - Archive/unarchive is the reversible alternative; it is offered inside the dialog, and after
 *   archiving a toast offers Undo (unarchive).
 * - The parent owns navigation: this component never redirects (K6); it calls onDeleted/onArchived.
 * - Only users allowed to delete render this component (permissions handled by the parent).
 * - Extra friction (typing the project name) applies only when the project has dependents.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ProjectRef { id: string; name: string }
interface Deps { tasks: number; files: number; members: number }

interface Props {
  project: ProjectRef;
  onDeleted: (project: ProjectRef) => void;
  onArchived?: (project: ProjectRef) => void;
  onUnarchived?: (project: ProjectRef) => void;
}

type DepsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; deps: Deps };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

async function api(method: "GET" | "POST" | "DELETE", url: string): Promise<Response> {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(String(res.status));
  return res;
}

const C = {
  text: "#1f2328", muted: "#565d66", border: "#8a929b", danger: "#b42318", dangerBg: "#fdecea",
  dangerDark: "#8f1b12", primary: "#0b5cad", bg: "#fff", ok: "#14532d",
};
const btn: React.CSSProperties = {
  minHeight: 32, minWidth: 80, padding: "0 14px", borderRadius: 6, font: "inherit",
  border: `1px solid ${C.border}`, background: "#fff", color: C.text, cursor: "pointer",
};

export function DeleteProject({ project, onDeleted, onArchived, onUnarchived }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [depsState, setDepsState] = useState<DepsState>({ status: "loading" });
  const [slow, setSlow] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<null | "delete" | "archive">(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<null | { text: string; undo?: () => void }>(null);
  const ids = { title: useId(), desc: useId(), input: useId(), err: useId() };

  const loadDeps = useCallback(async () => {
    setDepsState({ status: "loading" });
    try {
      const res = await api("GET", `/api/projects/${encodeURIComponent(project.id)}/dependencies`);
      setDepsState({ status: "ready", deps: await res.json() });
    } catch {
      setDepsState({ status: "error" });
    }
  }, [project.id]);

  // Open: fetch counts fresh every time (they may have changed since last time).
  const openDialog = () => {
    setTyped(""); setError(null); setOpen(true);
    void loadDeps();
  };
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); cancelRef.current?.focus(); } // safe default focus: Cancel
  }, [open]);

  // Working indicator only if loading takes > 1 s (K1).
  useEffect(() => {
    setSlow(false);
    if (depsState.status !== "loading" || !open) return;
    const t = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(t);
  }, [depsState.status, open]);

  const close = () => {
    if (busy) return; // can't leave a half-done request; buttons show progress
    dialogRef.current?.close();
    setOpen(false);
    triggerRef.current?.focus();
  };

  const showToast = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    setTimeout(() => setToast(null), 10000);
  };

  const hasDependents = depsState.status === "ready" &&
    depsState.deps.tasks + depsState.deps.files + depsState.deps.members > 0;
  const nameMatches = typed.trim() === project.name;
  const canDelete = depsState.status === "ready" && !busy && (!hasDependents || nameMatches);

  const doDelete = async () => {
    if (!canDelete) return;
    setBusy("delete"); setError(null);
    try {
      await api("DELETE", `/api/projects/${encodeURIComponent(project.id)}`);
      dialogRef.current?.close(); setOpen(false);
      showToast(`Project "${project.name}" was permanently deleted.`);
      onDeleted(project);
    } catch {
      setError(`"${project.name}" could not be deleted because the server did not respond as expected. Nothing was removed. Try again, or archive the project instead.`);
    } finally { setBusy(null); }
  };

  const doArchive = async () => {
    if (busy) return;
    setBusy("archive"); setError(null);
    try {
      await api("POST", `/api/projects/${encodeURIComponent(project.id)}/archive`);
      dialogRef.current?.close(); setOpen(false);
      showToast(`Project "${project.name}" archived.`, async () => {
        try {
          await api("POST", `/api/projects/${encodeURIComponent(project.id)}/unarchive`);
          setToast(null); onUnarchived?.(project);
        } catch { showToast("Could not restore the project from the archive. Try again from the archive list."); }
      });
      onArchived?.(project);
    } catch {
      setError(`"${project.name}" could not be archived because the server did not respond as expected. Nothing was changed. Try again.`);
    } finally { setBusy(null); }
  };

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openDialog}
        style={{ ...btn, color: C.danger, borderColor: C.danger }}>
        Delete project…
      </button>

      <dialog ref={dialogRef} aria-labelledby={ids.title} aria-describedby={ids.desc}
        onCancel={(e) => { e.preventDefault(); close(); }} // Esc = Cancel
        style={{ width: 480, maxWidth: "92vw", padding: 24, border: `1px solid ${C.border}`, borderRadius: 10,
          color: C.text, background: C.bg, font: "14px/1.45 system-ui, sans-serif" }}>
        <h2 id={ids.title} style={{ margin: "0 0 12px", fontSize: 18 }}>
          Delete project "{project.name}"?
        </h2>

        <div id={ids.desc}>
          {depsState.status === "loading" && (
            <p role="status" style={{ color: C.muted, minHeight: 40 }}>
              {slow ? "Checking what this project contains…" : " "}
            </p>
          )}
          {depsState.status === "error" && (
            <div role="alert" style={{ color: C.danger }}>
              <p style={{ margin: "0 0 8px" }}>
                We could not check what this project contains, so deleting is disabled until we can show you the impact.
                Check your connection and retry.
              </p>
              <button type="button" style={btn} onClick={loadDeps}>Retry</button>
            </div>
          )}
          {depsState.status === "ready" && (
            <>
              <p style={{ margin: "0 0 8px" }}>
                {hasDependents ? "This permanently deletes the project and everything in it:" : "This project is empty. It will be permanently deleted."}
              </p>
              {hasDependents && (
                <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
                  <li><strong>{plural(depsState.deps.tasks, "task", "tasks")}</strong></li>
                  <li><strong>{plural(depsState.deps.files, "file", "files")}</strong></li>
                  <li><strong>{plural(depsState.deps.members, "member", "members")}</strong> lose access</li>
                </ul>
              )}
              <p style={{ margin: "0 0 12px", fontWeight: 600, color: C.dangerDark }}>
                This cannot be undone.
              </p>
              <p style={{ margin: "0 0 4px", padding: 10, background: "#eef5fc", borderRadius: 6 }}>
                Not sure? <strong>Archive</strong> hides the project but keeps all its content, and you can restore it any time.
              </p>
            </>
          )}
        </div>

        {depsState.status === "ready" && hasDependents && (
          <div style={{ marginTop: 14 }}>
            <label htmlFor={ids.input}>
              To confirm, type the project name: <strong>{project.name}</strong>
            </label>
            <input id={ids.input} value={typed} autoComplete="off" spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void doDelete(); } }}
              aria-describedby={error ? ids.err : undefined}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, minHeight: 32,
                padding: "0 8px", font: "inherit", border: `1px solid ${C.border}`, borderRadius: 6 }} />
          </div>
        )}

        {error && (
          <p id={ids.err} role="alert" style={{ marginTop: 12, padding: 10, background: C.dangerBg, color: C.dangerDark, borderRadius: 6 }}>
            {error}
          </p>
        )}

        {/* Safe actions on the right (where the primary action is expected); destructive one is far left, red, outlined-to-solid only when armed. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, gap: 24 }}>
          <button type="button" onClick={doDelete} disabled={!canDelete}
            aria-disabled={!canDelete}
            style={{ ...btn, minWidth: 130,
              background: canDelete ? C.danger : "#fff", color: canDelete ? "#fff" : C.muted,
              borderColor: canDelete ? C.danger : "#c3c8cf", cursor: canDelete ? "pointer" : "not-allowed" }}>
            {busy === "delete" ? "Deleting…" : "Delete permanently"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button ref={cancelRef} type="button" style={btn} onClick={close} disabled={!!busy}>Cancel</button>
            <button type="button" onClick={doArchive} disabled={!!busy}
              style={{ ...btn, background: C.primary, borderColor: C.primary, color: "#fff" }}>
              {busy === "archive" ? "Archiving…" : "Archive instead"}
            </button>
          </div>
        </div>
        {hasDependents && !nameMatches && !busy && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: C.muted }}>
            "Delete permanently" is enabled once the name matches.
          </p>
        )}
      </dialog>

      {/* Normal outcomes are reported inline as a non-modal status, not a dialog (K1). */}
      <div role="status" aria-live="polite" style={{ position: "fixed", left: 24, bottom: 24 }}>
        {toast && (
          <div style={{ background: "#1f2328", color: "#fff", padding: "10px 14px", borderRadius: 8, display: "flex", gap: 16, alignItems: "center" }}>
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" onClick={toast.undo}
                style={{ ...btn, minHeight: 28, minWidth: 0, background: "transparent", color: "#fff", borderColor: "#fff" }}>
                Undo
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}
              style={{ ...btn, minHeight: 28, minWidth: 28, padding: 0, background: "transparent", color: "#fff", border: "none" }}>×</button>
          </div>
        )}
      </div>
    </>
  );
}

export default DeleteProject;
