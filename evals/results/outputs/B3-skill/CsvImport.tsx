/**
 * CsvImport – contact import from a CSV file (desktop, office staff, a few times a month).
 *
 * Assumptions (no one to ask):
 *  - Users are occasional: all text is plain-language, no shortcuts needed, nothing hidden behind hover.
 *  - Rows are processed independently; a bad row is skipped, the rest are imported. Cancelling keeps
 *    rows already imported (the UI says so explicitly, since we cannot undo them via this API).
 *  - `processed` counts every handled row (imported + skipped). Imported = processed - errors.length.
 *  - `errors` holds all skipped rows; `message` is server text, shown as-is plus a generic fix hint.
 *  - The import runs on the server: closing the tab does not stop it. The id is kept in localStorage
 *    so a reload resumes watching (K5). Only one import is tracked at a time.
 *  - Max file size 50 MB (adjust MAX_BYTES). Only .csv accepted.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

type ApiStatus = "running" | "done" | "failed" | "cancelled";
interface RowError { row: number; message: string }
interface ImportState { status: ApiStatus; processed: number; total: number; errors: RowError[] }

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "watching"; id: string; fileName: string | null; startedAt: number }
  | { kind: "finished"; id: string; fileName: string | null; result: ImportState };

const MAX_BYTES = 50 * 1024 * 1024;
const STORAGE_KEY = "csvImport.current";
const POLL_MS = 1500;
const ERRORS_SHOWN = 50;

const css = `
.ci{font:16px/1.5 system-ui,sans-serif;color:#1b1f24;max-width:720px;margin:0 auto;padding:24px}
.ci h2{font-size:22px;margin:0 0 4px}
.ci p{margin:0 0 12px}
.ci .muted{color:#4b5563}
.ci button,.ci .btn{min-height:40px;min-width:88px;padding:0 16px;font:inherit;border-radius:6px;border:1px solid #6b7280;background:#fff;color:#1b1f24;cursor:pointer}
.ci button:active{background:#e5e7eb;transform:translateY(1px)}
.ci button:disabled{color:#6b7280;background:#f3f4f6;cursor:not-allowed}
.ci button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.ci button.primary:active{background:#1e3a8a}
.ci button.primary:disabled{background:#6b7280;border-color:#6b7280;color:#fff}
.ci :focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
.ci .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.ci .spread{justify-content:space-between}
.ci .bar{height:16px;background:#e5e7eb;border-radius:8px;overflow:hidden;border:1px solid #6b7280}
.ci .bar>div{height:100%;background:#1d4ed8;transition:width .4s}
.ci .bar.indet>div{width:30%;animation:ci-slide 1.2s infinite ease-in-out}
@keyframes ci-slide{0%{margin-left:-30%}100%{margin-left:100%}}
@media (prefers-reduced-motion:reduce){.ci .bar.indet>div{animation:none;width:100%;opacity:.5}}
.ci .box{border:1px solid #6b7280;border-radius:8px;padding:16px;margin-top:16px}
.ci .ok{border-color:#15803d;background:#f0fdf4}
.ci .warn{border-color:#b45309;background:#fffbeb}
.ci .bad{border-color:#b91c1c;background:#fef2f2}
.ci .banner{border:1px solid #b45309;background:#fffbeb;padding:8px 12px;border-radius:6px;margin-top:12px}
.ci table{border-collapse:collapse;width:100%;margin-top:8px}
.ci th,.ci td{text-align:left;padding:6px 8px;border-bottom:1px solid #d1d5db;vertical-align:top}
.ci th{width:80px}
.ci .confirm{margin-top:12px;padding:12px;border:1px solid #b91c1c;border-radius:6px;background:#fef2f2}
.ci .danger{border-color:#b91c1c;color:#991b1b}
.ci .sr{position:absolute;left:-9999px}
`;

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} min ${s} sec` : `${m} min`;
}
const n = (x: number) => x.toLocaleString();

function errorsToCsv(errors: RowError[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return "row,problem\n" + errors.map((e) => `${e.row},${esc(e.message)}`).join("\n");
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const t = await res.text();
    if (t && t.length < 300 && !t.trim().startsWith("<")) return `${fallback} (${t.trim()})`;
  } catch { /* ignore */ }
  return `${fallback} (server answered ${res.status}).`;
}

export default function CsvImport(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [live, setLive] = useState<ImportState | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const samples = useRef<{ t: number; p: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  const remember = (v: { id: string; fileName: string | null; startedAt: number } | null) => {
    try { v ? localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) : localStorage.removeItem(STORAGE_KEY); } catch { /* optional */ }
  };

  // Resume an import that was running before a reload (K5).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v?.id) setPhase({ kind: "watching", id: v.id, fileName: v.fileName ?? null, startedAt: v.startedAt ?? Date.now() });
      }
    } catch { /* ignore */ }
  }, []);

  // Polling. A failed poll never means the import failed: keep trying and say so.
  const watchId = phase.kind === "watching" ? phase.id : null;
  useEffect(() => {
    if (!watchId) return;
    let stop = false;
    let timer: number;
    samples.current = [];
    const tick = async () => {
      try {
        const res = await fetch(`/api/imports/${encodeURIComponent(watchId)}`);
        if (res.status === 404) throw new Error("gone");
        if (!res.ok) throw new Error("http");
        const data: ImportState = await res.json();
        if (stop) return;
        setOffline(false);
        setLive(data);
        samples.current.push({ t: Date.now(), p: data.processed });
        if (samples.current.length > 8) samples.current.shift();
        if (data.status !== "running") {
          remember(null);
          setPhase((p) => (p.kind === "watching" ? { kind: "finished", id: p.id, fileName: p.fileName, result: data } : p));
          return;
        }
      } catch (e) {
        if (stop) return;
        if ((e as Error).message === "gone") {
          remember(null);
          setPhase({ kind: "idle" });
          setStartError("The earlier import could no longer be found on the server. Check your contact list, then start a new import if rows are missing.");
          return;
        }
        setOffline(true);
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [watchId]);

  // Elapsed-time clock.
  useEffect(() => {
    if (phase.kind !== "watching") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  // Move focus to the result heading when finished (K1/K11).
  useEffect(() => { if (phase.kind === "finished") resultRef.current?.focus(); }, [phase.kind]);

  const pick = useCallback((f: File | null | undefined) => {
    setStartError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setFile(null); setFileProblem(`"${f.name}" is not a CSV file. Export your contacts as .csv from Excel (Save as > CSV) and choose that file.`); return; }
    if (f.size === 0) { setFile(null); setFileProblem(`"${f.name}" is empty. Choose a file that contains contacts.`); return; }
    if (f.size > MAX_BYTES) { setFile(null); setFileProblem(`"${f.name}" is ${(f.size / 1048576).toFixed(0)} MB; the limit is ${MAX_BYTES / 1048576} MB. Split the file into smaller parts and import them one by one.`); return; }
    setFileProblem(null);
    setFile(f);
  }, []);

  const start = async () => {
    if (!file || phase.kind !== "idle") return; // double-trigger guard
    const fileName = file.name;
    setPhase({ kind: "uploading", fileName });
    setStartError(null); setLive(null); setOffline(false); setConfirmCancel(false); setCancelError(null); setShowAllErrors(false);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/imports", { method: "POST", body });
      if (!res.ok) throw new Error(await readError(res, "The server did not accept the file"));
      const { id } = await res.json();
      const info = { id: String(id), fileName, startedAt: Date.now() };
      remember(info);
      setPhase({ kind: "watching", ...info });
    } catch (e) {
      const m = (e as Error).message;
      // Keep the chosen file so the user can simply retry (K4/K5).
      setPhase({ kind: "idle" });
      setStartError(m.startsWith("The server") ? m : "The file could not be sent. Check your network connection and try again. Your file is still selected.");
    }
  };

  const cancel = async () => {
    if (phase.kind !== "watching" || cancelling) return;
    setCancelling(true); setCancelError(null);
    try {
      const res = await fetch(`/api/imports/${encodeURIComponent(phase.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 409) throw new Error();
      setConfirmCancel(false); // polling will pick up "cancelled"
    } catch {
      setCancelError("Cancel did not reach the server. The import is still running. Try again.");
    } finally { setCancelling(false); }
  };

  const reset = () => {
    setPhase({ kind: "idle" }); setFile(null); setLive(null); setFileProblem(null); setStartError(null);
    setTimeout(() => startRef.current?.focus(), 0);
  };

  const download = (errors: RowError[]) => {
    const url = URL.createObjectURL(new Blob([errorsToCsv(errors)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "import-problems.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- render ----------
  const busy = phase.kind === "uploading" || phase.kind === "watching";

  return (
    <div className="ci">
      <style>{css}</style>
      <h2>Import contacts from a CSV file</h2>

      {phase.kind === "idle" && (
        <>
          <p className="muted">Choose a .csv file with one contact per row. Large files can take several minutes; you can leave this page open or come back later.</p>
          <div
            className="box"
            style={{ borderStyle: "dashed", background: dragOver ? "#eff6ff" : undefined }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files[0]); }}
          >
            <div className="row">
              <input ref={inputRef} id="ci-file" type="file" accept=".csv,text/csv" className="sr" tabIndex={-1}
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" onClick={() => inputRef.current?.click()}>Choose file…</button>
              <span>{file ? <><strong>{file.name}</strong> ({(file.size / 1048576).toFixed(1)} MB)</> : "or drop a CSV file here"}</span>
            </div>
            {fileProblem && <p role="alert" style={{ color: "#991b1b", marginTop: 12, marginBottom: 0 }}><strong>Problem:</strong> {fileProblem}</p>}
          </div>
          {startError && <div role="alert" className="box bad"><strong>Import not started.</strong> {startError}</div>}
          <div className="row" style={{ marginTop: 16 }}>
            <button ref={startRef} type="button" className="primary" disabled={!file} onClick={start}>Start import</button>
            {!file && <span className="muted">Choose a file first.</span>}
          </div>
        </>
      )}

      {phase.kind === "uploading" && (
        <div className="box" role="status">
          <p><strong>Sending {phase.fileName}…</strong></p>
          <div className="bar indet" aria-hidden><div /></div>
          <p className="muted" style={{ marginTop: 8 }}>Keep this page open until sending has finished.</p>
          <button type="button" disabled>Start import</button>
        </div>
      )}

      {phase.kind === "watching" && (() => {
        const total = live?.total ?? 0;
        const processed = live?.processed ?? 0;
        const known = total > 0;
        const pct = known ? Math.min(100, Math.floor((processed / total) * 100)) : 0;
        const errs = live?.errors.length ?? 0;
        const elapsed = (now - phase.startedAt) / 1000;
        let eta = "";
        const s = samples.current;
        if (known && s.length >= 3) {
          const dt = (s[s.length - 1].t - s[0].t) / 1000;
          const dp = s[s.length - 1].p - s[0].p;
          if (dt > 3 && dp > 0) eta = `about ${fmtDuration((total - processed) / (dp / dt))} left (estimate)`;
        }
        return (
          <div className="box" aria-busy="true">
            <div className="row spread">
              <strong>Importing {phase.fileName ?? "file"}</strong>
              <span className="muted">Elapsed: {fmtDuration(elapsed)}</span>
            </div>
            <div
              className={`bar ${known ? "" : "indet"}`}
              style={{ margin: "12px 0 8px" }}
              role="progressbar" aria-label="Import progress"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined}
              aria-valuetext={known ? `${pct} percent, ${processed} of ${total} rows` : "Preparing"}
            >
              <div style={known ? { width: `${pct}%` } : undefined} />
            </div>
            <p style={{ marginBottom: 4 }}>
              {known ? <><strong>{pct}%</strong> – {n(processed)} of {n(total)} rows{eta ? ` – ${eta}` : ""}</> : "Preparing the file…"}
            </p>
            {errs > 0 && <p style={{ marginBottom: 4 }}>{n(errs)} row{errs === 1 ? "" : "s"} skipped so far. Details are shown when the import ends.</p>}
            <p className="muted">You can leave this page open in the background or close it – the import keeps running on the server.</p>

            {offline && <div role="status" className="banner">Connection to the server lost. The import is probably still running; this page keeps trying to reconnect. The numbers above may be out of date.</div>}

            <div className="row" style={{ marginTop: 16 }}>
              {!confirmCancel && <button type="button" className="danger" onClick={() => setConfirmCancel(true)}>Cancel import</button>}
            </div>
            {confirmCancel && (
              <div className="confirm" role="group" aria-label="Confirm cancel">
                <p style={{ marginBottom: 8 }}><strong>Stop this import?</strong> The {n(processed)} rows already processed stay in your contacts; the remaining rows will not be imported. This cannot be undone.</p>
                <div className="row">
                  <button type="button" autoFocus onClick={() => setConfirmCancel(false)}>Keep importing</button>
                  <button type="button" className="danger" disabled={cancelling} onClick={cancel}>{cancelling ? "Stopping…" : "Stop import"}</button>
                </div>
                {cancelError && <p role="alert" style={{ color: "#991b1b", margin: "8px 0 0" }}>{cancelError}</p>}
              </div>
            )}
          </div>
        );
      })()}

      {phase.kind === "finished" && (() => {
        const r = phase.result;
        const skipped = r.errors.length;
        const imported = Math.max(0, r.processed - skipped);
        const cls = r.status === "done" ? (skipped ? "warn" : "ok") : r.status === "cancelled" ? "warn" : "bad";
        const heading =
          r.status === "done" ? (skipped ? "Import finished with some skipped rows" : "Import finished")
          : r.status === "cancelled" ? "Import stopped"
          : "Import failed";
        const mark = cls === "ok" ? "✔" : cls === "warn" ? "⚠" : "✖";
        const shown = showAllErrors ? r.errors : r.errors.slice(0, ERRORS_SHOWN);
        return (
          <div className={`box ${cls}`}>
            <h3 ref={resultRef} tabIndex={-1} style={{ margin: "0 0 8px", fontSize: 18 }}><span aria-hidden>{mark} </span>{heading}</h3>
            {r.status === "done" && <p><strong>{n(imported)}</strong> of {n(r.total)} contacts imported{skipped ? <>, <strong>{n(skipped)}</strong> skipped.</> : "."}</p>}
            {r.status === "cancelled" && <p>You stopped the import. <strong>{n(imported)}</strong> contacts were imported before it stopped; the other {n(Math.max(0, r.total - r.processed))} rows were not. To add them later, remove the first {n(r.processed)} data rows from the file before importing it again; otherwise contacts may be duplicated.</p>}
            {r.status === "failed" && <p>The server stopped the import because of a problem on its side. <strong>{n(imported)}</strong> contacts were imported before it stopped. Try again later; if it keeps failing, contact IT support and give them the file name{phase.fileName ? ` "${phase.fileName}"` : ""}. Importing the whole file again may create duplicates.</p>}

            {skipped > 0 && (
              <>
                <p style={{ marginTop: 12, marginBottom: 4 }}><strong>Skipped rows.</strong> Correct these rows in your CSV file (the row number counts the data rows as in the file) and import just the corrected rows.</p>
                <table>
                  <thead><tr><th scope="col">Row</th><th scope="col">Problem</th></tr></thead>
                  <tbody>{shown.map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.message}</td></tr>)}</tbody>
                </table>
                <div className="row" style={{ marginTop: 12 }}>
                  {skipped > ERRORS_SHOWN && <button type="button" onClick={() => setShowAllErrors((v) => !v)}>{showAllErrors ? `Show first ${ERRORS_SHOWN} only` : `Show all ${n(skipped)}`}</button>}
                  <button type="button" onClick={() => download(r.errors)}>Download list (CSV)</button>
                </div>
              </>
            )}
            <div className="row" style={{ marginTop: 20 }}>
              <button type="button" className="primary" onClick={reset}>Import another file</button>
            </div>
          </div>
        );
      })()}

      {/* Announce milestones only, not every poll. */}
      <div className="sr" aria-live="polite">
        {phase.kind === "finished" ? `Import ${phase.result.status}.` : busy ? "Import in progress." : ""}
      </div>
    </div>
  );
}
