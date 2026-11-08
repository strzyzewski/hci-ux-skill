/**
 * CsvImport - contact CSV import UI.
 *
 * Assumptions (no one to ask):
 * - `processed` counts every row handled, including rows that errored;
 *   successful rows = processed - errors.length. `total` may be 0/unknown
 *   early on, so progress is indeterminate until total > 0.
 * - `errors` may be capped/partial server-side; we show what we get.
 * - Users are on desktop, infrequent: plain-language labels, no shortcuts needed.
 * - Max file size 50 MB client-side guard (server remains authoritative).
 * - Cancelling keeps rows already imported (the API gives no rollback); we say so.
 * - Auth is cookie-based; no extra headers required.
 * - The import keeps running server-side if the tab closes, so we remember the
 *   import id in localStorage and reconnect on reload.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "running" | "done" | "failed" | "cancelled";
interface RowError { row: number; message: string }
interface ImportState { status: Status; processed: number; total: number; errors: RowError[] }

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "tracking"; id: string; state: ImportState | null; cancelling: boolean }
  | { kind: "finished"; id: string; state: ImportState };

const MAX_BYTES = 50 * 1024 * 1024;
const STORAGE_KEY = "csvImport.activeId";
const POLL_MS = 1500;
const MAX_POLL_MS = 10000;

const fmtNum = (n: number) => n.toLocaleString();
function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${s} sec`;
}
function fmtSize(b: number) {
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
const safeStore = {
  get: () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
};

function validateFile(f: File): string | null {
  if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return "This is not a CSV file. Export your contacts as .csv and try again.";
  if (f.size === 0) return "This file is empty.";
  if (f.size > MAX_BYTES) return `This file is ${fmtSize(f.size)}. The limit is ${fmtSize(MAX_BYTES)}. Split it into smaller files.`;
  return null;
}

function errorsToCsv(errors: RowError[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ["row,message", ...errors.map((e) => `${e.row},${q(e.message)}`)].join("\n");
}

export default function CsvImport(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [announce, setAnnounce] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number>(Date.now());
  const samples = useRef<{ t: number; p: number }[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastAnnouncedPct = useRef(-10);

  const trackingId = phase.kind === "tracking" ? phase.id : null;

  // Reconnect to an import started before a reload.
  useEffect(() => {
    const id = safeStore.get();
    if (id) {
      startedAt.current = Date.now();
      setPhase({ kind: "tracking", id, state: null, cancelling: false });
    }
  }, []);

  // Polling with backoff on failure; stops on terminal status.
  useEffect(() => {
    if (!trackingId) return;
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;

    const tick = async () => {
      try {
        const res = await fetch(`/api/imports/${encodeURIComponent(trackingId)}`);
        if (res.status === 404) {
          safeStore.clear();
          if (!stopped) {
            setPhase({ kind: "idle" });
            setRequestError("We could not find that import. It may have expired. Please upload the file again.");
          }
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ImportState;
        if (stopped) return;
        failures = 0;
        setConnectionLost(false);
        samples.current.push({ t: Date.now(), p: data.processed });
        if (samples.current.length > 12) samples.current.shift();
        if (data.status === "running") {
          setPhase((p) => (p.kind === "tracking" ? { ...p, state: data } : p));
          const pct = data.total > 0 ? Math.floor((data.processed / data.total) * 100) : 0;
          if (pct - lastAnnouncedPct.current >= 10) {
            lastAnnouncedPct.current = pct;
            setAnnounce(`Import ${pct} percent complete.`);
          }
        } else {
          safeStore.clear();
          setPhase({ kind: "finished", id: trackingId, state: data });
          setAnnounce(
            data.status === "done" ? "Import finished." : data.status === "cancelled" ? "Import cancelled." : "Import failed."
          );
          return;
        }
      } catch {
        failures++;
        if (!stopped && failures >= 2) setConnectionLost(true);
      }
      if (!stopped) timer = window.setTimeout(tick, Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS));
    };
    tick();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [trackingId]);

  // Elapsed-time clock only while tracking.
  useEffect(() => {
    if (phase.kind !== "tracking") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase.kind]);

  // Warn before leaving mid-upload (the file would be lost).
  useEffect(() => {
    if (phase.kind !== "uploading") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase.kind]);

  // Move focus to the heading when the view changes so keyboard/SR users land on the result.
  useEffect(() => { headingRef.current?.focus(); }, [phase.kind]);

  const chooseFile = useCallback((f: File | undefined | null) => {
    setRequestError(null);
    if (!f) return;
    const err = validateFile(f);
    setFileError(err);
    setFile(err ? null : f);
  }, []);

  const start = async () => {
    if (!file) return;
    setRequestError(null);
    setPhase({ kind: "uploading" });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/imports", { method: "POST", body });
      if (!res.ok) throw new Error(String(res.status));
      const { id } = (await res.json()) as { id: string };
      safeStore.set(id);
      startedAt.current = Date.now();
      samples.current = [];
      lastAnnouncedPct.current = -10;
      setPhase({ kind: "tracking", id, state: null, cancelling: false });
    } catch {
      setPhase({ kind: "idle" });
      setRequestError("The file could not be uploaded. Nothing was imported. Check your connection and try again.");
    }
  };

  const cancel = async () => {
    if (phase.kind !== "tracking") return;
    setConfirmCancel(false);
    setPhase({ ...phase, cancelling: true });
    try {
      const res = await fetch(`/api/imports/${encodeURIComponent(phase.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(String(res.status));
      // Polling will pick up the "cancelled" (or already "done") status.
    } catch {
      setPhase((p) => (p.kind === "tracking" ? { ...p, cancelling: false } : p));
      setRequestError("Cancelling did not work. The import is still running. Please try again.");
    }
  };

  const reset = () => {
    safeStore.clear();
    setFile(null);
    setFileError(null);
    setRequestError(null);
    setConnectionLost(false);
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadErrors = (errors: RowError[]) => {
    const url = URL.createObjectURL(new Blob([errorsToCsv(errors)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "import-errors.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Time estimate from recent throughput; hidden until stable.
  const eta = useMemo(() => {
    if (phase.kind !== "tracking" || !phase.state || phase.state.total <= 0) return "";
    const s = samples.current;
    if (s.length < 3) return "";
    const first = s[0], last = s[s.length - 1];
    const dt = (last.t - first.t) / 1000;
    const dp = last.p - first.p;
    if (dt < 4 || dp <= 0) return "";
    const remaining = (phase.state.total - phase.state.processed) / (dp / dt);
    return remaining > 5 ? `About ${fmtDuration(Math.round(remaining / 5) * 5)} left` : "Almost done";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, now]);

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div aria-live="polite" role="status" style={S.srOnly}>{announce}</div>

        {phase.kind === "idle" && (
          <section aria-labelledby="h">
            <h1 id="h" ref={headingRef} tabIndex={-1} style={S.h1}>Import contacts from a CSV file</h1>
            <p style={S.p}>
              Each row becomes a contact. Large files can take several minutes. You can leave this page open
              and keep working in other tabs.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files[0]); }}
              style={{ ...S.drop, ...(dragging ? S.dropActive : {}) }}
            >
              {file ? (
                <p style={{ margin: 0 }}>
                  <strong>{file.name}</strong> <span style={S.muted}>({fmtSize(file.size)})</span>
                </p>
              ) : (
                <p style={{ margin: 0 }}>Drag a CSV file here, or</p>
              )}
              <input
                ref={inputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => chooseFile(e.target.files?.[0])}
                aria-describedby={fileError ? "file-err" : undefined}
                style={S.srOnly}
              />
              <label htmlFor="csv-file" style={S.secondaryBtn} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}>
                {file ? "Choose a different file" : "Choose file"}
              </label>
            </div>

            {fileError && <p id="file-err" role="alert" style={S.error}>{fileError}</p>}
            {requestError && <p role="alert" style={S.error}>{requestError}</p>}

            <div style={{ marginTop: 20 }}>
              <button type="button" onClick={start} disabled={!file} style={{ ...S.primaryBtn, ...(file ? {} : S.disabled) }}>
                Start import
              </button>
            </div>
          </section>
        )}

        {phase.kind === "uploading" && (
          <section aria-labelledby="h">
            <h1 id="h" ref={headingRef} tabIndex={-1} style={S.h1}>Uploading {file?.name}...</h1>
            <div style={S.track} role="progressbar" aria-label="Uploading file"><div style={S.indeterminate} /></div>
            <p style={S.p}>Keep this page open until the upload finishes. Large files can take a minute.</p>
          </section>
        )}

        {phase.kind === "tracking" && (() => {
          const st = phase.state;
          const known = !!st && st.total > 0;
          const pct = known ? Math.min(100, Math.floor((st!.processed / st!.total) * 100)) : 0;
          const elapsed = (now - startedAt.current) / 1000;
          return (
            <section aria-labelledby="h">
              <h1 id="h" ref={headingRef} tabIndex={-1} style={S.h1}>
                {phase.cancelling ? "Cancelling import..." : "Importing contacts..."}
              </h1>
              <div
                style={S.track}
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={known ? pct : undefined}
                aria-valuetext={known ? `${pct} percent, ${st!.processed} of ${st!.total} rows` : "Preparing"}
              >
                {known ? <div style={{ ...S.fill, width: `${pct}%` }} /> : <div style={S.indeterminate} />}
              </div>
              <p style={S.progressLine}>
                {known ? (
                  <><strong>{fmtNum(st!.processed)}</strong> of {fmtNum(st!.total)} rows ({pct}%)</>
                ) : "Preparing the file..."}
              </p>
              <p style={S.muted}>
                Elapsed: {fmtDuration(elapsed)}{eta ? ` · ${eta}` : ""}
                {st && st.errors.length > 0 ? ` · ${fmtNum(st.errors.length)} row${st.errors.length === 1 ? "" : "s"} with problems so far` : ""}
              </p>

              {connectionLost && (
                <p role="alert" style={S.warn}>
                  Lost contact with the server. The import keeps running there; we are retrying automatically.
                </p>
              )}
              {requestError && <p role="alert" style={S.error}>{requestError}</p>}

              {!confirmCancel ? (
                <div style={{ marginTop: 20 }}>
                  <button type="button" onClick={() => setConfirmCancel(true)} disabled={phase.cancelling} style={{ ...S.secondaryBtn, ...(phase.cancelling ? S.disabled : {}) }}>
                    Cancel import
                  </button>
                </div>
              ) : (
                <div role="alertdialog" aria-labelledby="cc" style={S.confirm}>
                  <p id="cc" style={{ margin: "0 0 12px" }}>
                    Stop the import? Contacts already imported ({fmtNum(st?.processed ?? 0)} rows) will
                    <strong> stay</strong>. The rest will not be added.
                  </p>
                  <button type="button" onClick={cancel} style={S.dangerBtn} autoFocus>Yes, stop import</button>{" "}
                  <button type="button" onClick={() => setConfirmCancel(false)} style={S.secondaryBtn}>Keep importing</button>
                </div>
              )}
            </section>
          );
        })()}

        {phase.kind === "finished" && (() => {
          const { status, processed, total, errors } = phase.state;
          const ok = Math.max(0, processed - errors.length);
          const title =
            status === "done" ? (errors.length ? "Import finished with some problems" : "Import finished")
            : status === "cancelled" ? "Import cancelled" : "Import failed";
          return (
            <section aria-labelledby="h">
              <h1 id="h" ref={headingRef} tabIndex={-1} style={S.h1}>{title}</h1>
              <ul style={S.summary}>
                <li><strong>{fmtNum(ok)}</strong> contact{ok === 1 ? "" : "s"} imported</li>
                {errors.length > 0 && <li><strong>{fmtNum(errors.length)}</strong> row{errors.length === 1 ? "" : "s"} skipped because of problems</li>}
                {status !== "done" && total > processed && <li><strong>{fmtNum(total - processed)}</strong> row{total - processed === 1 ? "" : "s"} not processed</li>}
              </ul>
              {status === "cancelled" && <p style={S.p}>Contacts imported before you cancelled were kept.</p>}
              {status === "failed" && (
                <p style={S.p}>
                  Something went wrong on the server and the import stopped. Contacts imported before the failure were kept.
                  Fix any problems listed below, remove rows already imported from your file to avoid duplicates, and try again.
                  If it keeps failing, contact support and quote import ID <code>{phase.id}</code>.
                </p>
              )}

              {errors.length > 0 && (
                <>
                  <h2 style={S.h2}>Rows that were not imported</h2>
                  <p style={S.muted}>Row numbers match your file (row 1 is the header). Fix these rows and import them again.</p>
                  <div style={S.tableWrap} tabIndex={0} role="region" aria-label="Rows with problems">
                    <table style={S.table}>
                      <thead><tr><th style={S.th} scope="col">Row</th><th style={S.th} scope="col">Problem</th></tr></thead>
                      <tbody>
                        {errors.map((e, i) => (
                          <tr key={`${e.row}-${i}`}><td style={S.td}>{fmtNum(e.row)}</td><td style={S.td}>{e.message}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={() => downloadErrors(errors)} style={{ ...S.secondaryBtn, marginTop: 12 }}>
                    Download problem list (CSV)
                  </button>
                </>
              )}

              <div style={{ marginTop: 24 }}>
                <button type="button" onClick={reset} style={S.primaryBtn}>Import another file</button>
              </div>
            </section>
          );
        })()}
      </div>
    </main>
  );
}

const C = { ink: "#1b1f24", muted: "#586069", line: "#d0d7de", brand: "#0b5cad", danger: "#b42318", warnBg: "#fff4d6", errBg: "#fdecea" };
const btn: React.CSSProperties = { font: "inherit", fontSize: 15, padding: "10px 18px", borderRadius: 6, cursor: "pointer", display: "inline-block", minHeight: 40, boxSizing: "border-box" };
const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", color: C.ink, padding: 32, display: "flex", justifyContent: "center" },
  card: { width: "100%", maxWidth: 720 },
  h1: { fontSize: 24, margin: "0 0 12px", outline: "none" },
  h2: { fontSize: 18, margin: "24px 0 4px" },
  p: { lineHeight: 1.5, margin: "0 0 16px" },
  muted: { color: C.muted, fontSize: 14, margin: "0 0 8px" },
  drop: { border: `2px dashed ${C.line}`, borderRadius: 8, padding: 28, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" },
  dropActive: { borderColor: C.brand, background: "#eef5fc" },
  primaryBtn: { ...btn, background: C.brand, color: "#fff", border: `1px solid ${C.brand}` },
  secondaryBtn: { ...btn, background: "#fff", color: C.ink, border: `1px solid ${C.muted}` },
  dangerBtn: { ...btn, background: C.danger, color: "#fff", border: `1px solid ${C.danger}` },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  error: { color: C.danger, background: C.errBg, padding: "10px 12px", borderRadius: 6, margin: "12px 0 0" },
  warn: { background: C.warnBg, padding: "10px 12px", borderRadius: 6, margin: "12px 0 0" },
  track: { height: 14, background: "#e6eaee", borderRadius: 7, overflow: "hidden", position: "relative", margin: "16px 0 8px" },
  fill: { height: "100%", background: C.brand, transition: "width .6s ease" },
  indeterminate: { position: "absolute", height: "100%", width: "30%", background: C.brand, left: "35%", opacity: 0.6 },
  progressLine: { fontSize: 18, margin: "0 0 4px" },
  confirm: { marginTop: 20, padding: 16, border: `1px solid ${C.danger}`, borderRadius: 8 },
  summary: { lineHeight: 1.8, fontSize: 17, paddingLeft: 20, margin: "0 0 16px" },
  tableWrap: { maxHeight: 360, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 6 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { position: "sticky", top: 0, background: "#f3f5f7", textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${C.line}` },
  td: { padding: "8px 12px", borderBottom: `1px solid ${C.line}`, verticalAlign: "top" },
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
};
