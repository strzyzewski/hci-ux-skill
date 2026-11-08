/**
 * ContactForm – company website contact form (React + TypeScript, no UI libs).
 *
 * Assumptions (nobody to ask):
 * - Visitors are occasional, first-time users on desktop and mobile; an error costs a lost lead
 *   (annoying, not irreversible), so we never discard typed input.
 * - Single language (English); strings are collected in TEXT for easy translation.
 * - POST /api/contact takes JSON {name,email,phone,message}; 201 = ok,
 *   422 = {errors:{field:message}} (server messages are shown verbatim), 5xx/network = retryable.
 * - Phone is optional and international, so it is validated leniently (digits + common separators).
 * - No privacy/consent text is specified, so none is added.
 */
import React, { useEffect, useRef, useState } from "react";

type FieldName = "name" | "email" | "phone" | "message";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;
type Status = "idle" | "sending" | "success";

const EMPTY: Values = { name: "", email: "", phone: "", message: "" };
const DRAFT_KEY = "contact-form-draft";

const TEXT = {
  required: (label: string) => `Please enter your ${label}.`,
  emailInvalid: "This email address looks incomplete. Use the form name@example.com.",
  phoneInvalid: "Use digits only, optionally with + ( ) - and spaces, e.g. +49 30 1234567.",
  serverDown:
    "We could not send your message because our server had a problem. Your text is still here. Please try again in a moment.",
  network:
    "We could not reach the server. Check your connection, then press Send message again. Your text is still here.",
  unknown422: "The server rejected your message. Please check the fields below.",
};

const LABELS: Record<FieldName, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  message: "Message",
};
const ORDER: FieldName[] = ["name", "email", "phone", "message"];

function validateField(field: FieldName, raw: string): string | undefined {
  const v = raw.trim();
  switch (field) {
    case "name":
      return v ? undefined : TEXT.required("name");
    case "message":
      return v ? undefined : TEXT.required("message");
    case "email":
      if (!v) return TEXT.required("email address");
      // Deliberately permissive: one @, no spaces, a dot in the domain. The server is the authority.
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? undefined : TEXT.emailInvalid;
    case "phone": {
      if (!v) return undefined; // optional
      const digits = v.replace(/\D/g, "");
      return /^[+\d][\d\s().\-/]*$/.test(v) && digits.length >= 5 && digits.length <= 15
        ? undefined
        : TEXT.phoneInvalid;
    }
  }
}

function validateAll(values: Values): Errors {
  const errors: Errors = {};
  for (const f of ORDER) {
    const e = validateField(f, values[f]);
    if (e) errors[f] = e;
  }
  return errors;
}

function loadDraft(): Values | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = { ...EMPTY, ...JSON.parse(raw) } as Values;
    return ORDER.some((f) => parsed[f]) ? parsed : null;
  } catch {
    return null;
  }
}
function saveDraft(values: Values) {
  try {
    if (ORDER.some((f) => values[f])) localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: form still works */
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export default function ContactForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [extraErrors, setExtraErrors] = useState<string[]>([]); // server errors for unknown fields
  const [status, setStatus] = useState<Status>("idle");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [showErrorSummary, setShowErrorSummary] = useState(false);

  const sendingRef = useRef(false); // synchronous double-submit guard
  const abortRef = useRef<AbortController | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  // K5/K7: restore an unsent draft (e.g. after reload or a failed send).
  useEffect(() => {
    const d = loadDraft();
    if (d) {
      setValues(d);
      setRestored(true);
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  function update(field: FieldName, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    saveDraft(next);
    setRestored(false);
    // Once a field shows an error, re-check live so the message disappears as soon as it is fixed.
    if (errors[field]) {
      const e = validateField(field, value);
      setErrors((prev) => {
        const copy = { ...prev };
        if (e) copy[field] = e;
        else delete copy[field];
        return copy;
      });
    }
  }

  // Validate on leaving the field, not while typing (non-disruptive).
  function onBlur(field: FieldName) {
    const e = validateField(field, values[field]);
    setErrors((prev) => {
      const copy = { ...prev };
      if (e) copy[field] = e;
      else delete copy[field];
      return copy;
    });
  }

  function focusProblem(errs: Errors, extras: string[]) {
    // Focus a summary (links to each field) when several problems exist; otherwise the one field.
    const keys = ORDER.filter((f) => errs[f]);
    if (keys.length === 1 && extras.length === 0) {
      fieldRefs.current[keys[0]]?.focus();
    } else {
      summaryRef.current?.focus();
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sendingRef.current) return;

    const clientErrors = validateAll(values);
    setBannerError(null);
    setExtraErrors([]);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setShowErrorSummary(true);
      // wait for render so the summary exists
      requestAnimationFrame(() => focusProblem(clientErrors, []));
      return;
    }

    sendingRef.current = true;
    setStatus("sending");
    setErrors({});
    setShowErrorSummary(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          message: values.message.trim(),
        }),
        signal: ctrl.signal,
      });

      if (res.status === 201) {
        clearDraft();
        setValues(EMPTY);
        setStatus("success");
        requestAnimationFrame(() => successRef.current?.focus());
        return;
      }

      if (res.status === 422) {
        let serverErrors: Record<string, string> = {};
        try {
          serverErrors = (await res.json())?.errors ?? {};
        } catch {
          /* fall through to generic message */
        }
        const fieldErrs: Errors = {};
        const extras: string[] = [];
        for (const [k, msg] of Object.entries(serverErrors)) {
          if ((ORDER as string[]).includes(k)) fieldErrs[k as FieldName] = String(msg);
          else extras.push(String(msg));
        }
        if (!Object.keys(fieldErrs).length && !extras.length) extras.push(TEXT.unknown422);
        setErrors(fieldErrs);
        setExtraErrors(extras);
        setShowErrorSummary(true);
        setStatus("idle");
        requestAnimationFrame(() => focusProblem(fieldErrs, extras));
        return;
      }

      // 5xx or anything unexpected: keep all input, allow retry.
      setBannerError(TEXT.serverDown);
      setStatus("idle");
      requestAnimationFrame(() => bannerRef.current?.focus());
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setStatus("idle"); // user cancelled; nothing lost
        return;
      }
      setBannerError(TEXT.network);
      setStatus("idle");
      requestAnimationFrame(() => bannerRef.current?.focus());
    } finally {
      sendingRef.current = false;
      abortRef.current = null;
    }
  }

  function resetAfterSuccess() {
    setStatus("idle");
    setBannerError(null);
    setErrors({});
    setExtraErrors([]);
  }

  const sending = status === "sending";
  const errorKeys = ORDER.filter((f) => errors[f]);

  if (status === "success") {
    return (
      <div className="cf-root">
        <style>{CSS}</style>
        <div className="cf-success" role="status">
          <h2 ref={successRef} tabIndex={-1}>
            Message sent
          </h2>
          <p>Thank you. We have received your message and will reply to the email address you gave.</p>
          <button type="button" className="cf-btn cf-secondary" onClick={resetAfterSuccess}>
            Write another message
          </button>
        </div>
      </div>
    );
  }

  function field(
    name: FieldName,
    opts: {
      required?: boolean;
      type?: string;
      autoComplete: string;
      inputMode?: React.HTMLAttributes<HTMLElement>["inputMode"];
      hint?: string;
      textarea?: boolean;
    }
  ) {
    const id = `cf-${name}`;
    const err = errors[name];
    const describedBy = [opts.hint ? `${id}-hint` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
    const common = {
      id,
      name,
      value: values[name],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(name, e.target.value),
      onBlur: () => onBlur(name),
      autoComplete: opts.autoComplete,
      "aria-invalid": err ? true : undefined,
      "aria-required": opts.required ? true : undefined,
      "aria-describedby": describedBy,
      readOnly: sending, // keep focus and values stable while sending
      className: "cf-input" + (err ? " cf-invalid" : ""),
    };
    return (
      <div className="cf-field">
        <label htmlFor={id}>
          {LABELS[name]} <span className="cf-req">{opts.required ? "(required)" : "(optional)"}</span>
        </label>
        {opts.hint && (
          <div id={`${id}-hint`} className="cf-hint">
            {opts.hint}
          </div>
        )}
        {opts.textarea ? (
          <textarea
            {...common}
            rows={6}
            ref={(el) => {
              fieldRefs.current[name] = el;
            }}
          />
        ) : (
          <input
            {...common}
            type={opts.type ?? "text"}
            inputMode={opts.inputMode}
            ref={(el) => {
              fieldRefs.current[name] = el;
            }}
          />
        )}
        {err && (
          <div id={`${id}-err`} className="cf-error">
            <span aria-hidden="true" className="cf-icon">
              !
            </span>
            <span>
              <span className="cf-sr">Error: </span>
              {err}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cf-root">
      <style>{CSS}</style>
      <form onSubmit={onSubmit} noValidate aria-busy={sending}>
        <h2>Contact us</h2>
        <p className="cf-intro">Fields marked (required) must be filled in.</p>

        {restored && (
          <p className="cf-note" role="status">
            We restored the message you had started earlier.{" "}
            <button
              type="button"
              className="cf-link"
              onClick={() => {
                setValues(EMPTY);
                clearDraft();
                setRestored(false);
                setErrors({});
              }}
            >
              Clear form
            </button>
          </p>
        )}

        {bannerError && (
          <div className="cf-banner" role="alert" tabIndex={-1} ref={bannerRef}>
            <span aria-hidden="true" className="cf-icon">
              !
            </span>
            <span>{bannerError}</span>
          </div>
        )}

        {showErrorSummary && (errorKeys.length > 0 || extraErrors.length > 0) && (
          <div className="cf-banner" role="alert" tabIndex={-1} ref={summaryRef}>
            <span aria-hidden="true" className="cf-icon">
              !
            </span>
            <div>
              <strong>
                {errorKeys.length + extraErrors.length === 1
                  ? "1 thing needs your attention:"
                  : `${errorKeys.length + extraErrors.length} things need your attention:`}
              </strong>
              <ul>
                {errorKeys.map((f) => (
                  <li key={f}>
                    <a
                      href={`#cf-${f}`}
                      onClick={(e) => {
                        e.preventDefault();
                        fieldRefs.current[f]?.focus();
                      }}
                    >
                      {LABELS[f]}: {errors[f]}
                    </a>
                  </li>
                ))}
                {extraErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {field("name", { required: true, autoComplete: "name" })}
        {field("email", { required: true, type: "email", autoComplete: "email", inputMode: "email" })}
        {field("phone", {
          type: "tel",
          autoComplete: "tel",
          inputMode: "tel",
          hint: "Only if you would like a call back.",
        })}
        {field("message", { required: true, autoComplete: "off", textarea: true })}

        <div className="cf-actions">
          <button
            type="submit"
            className="cf-btn cf-primary"
            aria-disabled={sending}
            onClick={(e) => {
              if (sending) e.preventDefault();
            }}
          >
            {sending && <span className="cf-spinner" aria-hidden="true" />}
            {sending ? "Sending…" : "Send message"}
          </button>
          {sending && (
            <button type="button" className="cf-btn cf-secondary" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>
        <p className="cf-sr" role="status">
          {sending ? "Sending your message" : ""}
        </p>
      </form>
    </div>
  );
}

// Colours: text #1a1a1a on #fff (17:1); error #a50e0e on #fff (7.5:1); borders #6b6b6b (5.3:1, >= 3:1 for UI).
const CSS = `
.cf-root{max-width:36rem;margin:0 auto;padding:16px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a}
.cf-root *{box-sizing:border-box}
.cf-root h2{margin:0 0 4px;font-size:1.5rem}
.cf-intro{margin:0 0 16px;color:#444}
.cf-field{margin-bottom:20px}
.cf-field label{display:block;font-weight:600;margin-bottom:4px}
.cf-req{font-weight:400;color:#444}
.cf-hint{color:#444;font-size:.875rem;margin-bottom:4px}
.cf-input{display:block;width:100%;min-height:48px;padding:10px 12px;font:inherit;color:inherit;background:#fff;border:2px solid #6b6b6b;border-radius:6px}
textarea.cf-input{resize:vertical;min-height:140px}
.cf-input:focus-visible,.cf-btn:focus-visible,.cf-link:focus-visible,.cf-banner:focus-visible,.cf-banner a:focus-visible,.cf-success h2:focus-visible{outline:3px solid #0b57d0;outline-offset:2px}
.cf-input.cf-invalid{border-color:#a50e0e}
.cf-input[readonly]{background:#f3f3f3}
.cf-error{display:flex;gap:8px;align-items:flex-start;margin-top:6px;color:#a50e0e;font-size:.9375rem}
.cf-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#a50e0e;color:#fff;font-weight:700;font-size:.8125rem;line-height:1}
.cf-banner{display:flex;gap:10px;align-items:flex-start;padding:12px;margin-bottom:20px;border:2px solid #a50e0e;border-radius:6px;background:#fff5f5;color:#1a1a1a}
.cf-banner ul{margin:4px 0 0;padding-left:20px}
.cf-banner a{color:#a50e0e;display:inline-block;padding:4px 0}
.cf-note{margin:0 0 16px;padding:10px 12px;border:1px solid #6b6b6b;border-radius:6px;background:#f6f6f6}
.cf-link{background:none;border:0;padding:12px 4px;min-height:44px;font:inherit;color:#0b57d0;text-decoration:underline;cursor:pointer}
.cf-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.cf-btn{min-height:48px;min-width:48px;padding:10px 24px;font:inherit;font-weight:600;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.cf-primary{background:#0b57d0;color:#fff;border:2px solid #0b57d0;flex:1 1 12rem}
.cf-primary:hover{background:#0a47a9}
.cf-primary:active{background:#083a8a;transform:translateY(1px)}
.cf-primary[aria-disabled="true"]{background:#4a4a4a;border-color:#4a4a4a;cursor:progress}
.cf-secondary{background:#fff;color:#1a1a1a;border:2px solid #6b6b6b}
.cf-secondary:active{background:#e8e8e8}
.cf-spinner{width:16px;height:16px;border:3px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:cf-spin .8s linear infinite}
@keyframes cf-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.cf-spinner{animation-duration:2.4s}}
.cf-success{padding:16px;border:2px solid #1b6e2d;border-radius:6px;background:#f2faf3}
.cf-success h2:before{content:"\\2713  "}
.cf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
