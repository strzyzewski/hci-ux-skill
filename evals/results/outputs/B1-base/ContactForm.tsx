import React, { useId, useRef, useState } from "react";

/*
 * Assumptions:
 * - POST /api/contact with JSON {name, email, phone, message}; phone omitted when empty.
 * - 201 = success; 422 = {errors:{field:message}}; anything else / network failure = generic retryable error.
 * - Unknown field keys in a 422 are shown in the form-level alert.
 * - Max message length 2000 (adjust to backend).
 * - Phone is loosely validated client-side (digits, spaces, + - ( ) .), 6-20 chars.
 */

type Field = "name" | "email" | "phone" | "message";
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;
type Status = "idle" | "submitting" | "success" | "error";

const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d][\d\s().-]{5,19}$/;
const ORDER: Field[] = ["name", "email", "phone", "message"];

function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.name.trim()) e.name = "Please enter your name.";
  if (!v.email.trim()) e.email = "Please enter your email address.";
  else if (!EMAIL_RE.test(v.email.trim()))
    e.email = "Please enter a valid email address, like name@example.com.";
  if (v.phone.trim() && !PHONE_RE.test(v.phone.trim()))
    e.phone = "Please enter a valid phone number, or leave this empty.";
  if (!v.message.trim()) e.message = "Please enter a message.";
  else if (v.message.length > MAX_MESSAGE)
    e.message = `Please keep your message under ${MAX_MESSAGE} characters.`;
  return e;
}

export default function ContactForm() {
  const uid = useId();
  const [values, setValues] = useState<Values>({ name: "", email: "", phone: "", message: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState("");
  const refs = useRef<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>({
    name: null, email: null, phone: null, message: null,
  });
  const successRef = useRef<HTMLHeadingElement>(null);
  const busy = status === "submitting";

  const set = (f: Field, val: string) => {
    const next = { ...values, [f]: val };
    setValues(next);
    // Re-validate live only once the field has been blurred or errored, so we never nag mid-typing.
    if (touched[f] || errors[f]) {
      const e = validate(next)[f];
      setErrors((p) => ({ ...p, [f]: e }));
    }
  };

  const blur = (f: Field) => {
    setTouched((p) => ({ ...p, [f]: true }));
    setErrors((p) => ({ ...p, [f]: validate(values)[f] }));
  };

  const focusFirst = (e: Errors) => {
    const first = ORDER.find((f) => e[f]);
    if (first) refs.current[first]?.focus();
  };

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const local = validate(values);
    setErrors(local);
    setTouched({ name: true, email: true, phone: true, message: true });
    setFormError("");
    if (Object.keys(local).length) {
      focusFirst(local);
      return;
    }
    setStatus("submitting");
    try {
      const payload: Record<string, string> = {
        name: values.name.trim(),
        email: values.email.trim(),
        message: values.message.trim(),
      };
      if (values.phone.trim()) payload.phone = values.phone.trim();
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        setStatus("success");
        setValues({ name: "", email: "", phone: "", message: "" });
        setTouched({});
        setErrors({});
        setTimeout(() => successRef.current?.focus(), 0);
        return;
      }
      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        const server: Record<string, string> = data?.errors ?? {};
        const mapped: Errors = {};
        const extra: string[] = [];
        Object.entries(server).forEach(([k, msg]) => {
          if ((ORDER as string[]).includes(k)) mapped[k as Field] = String(msg);
          else extra.push(String(msg));
        });
        setErrors(mapped);
        setStatus("error");
        setFormError(
          extra.join(" ") ||
            (Object.keys(mapped).length
              ? "Please correct the highlighted fields and send again. Your message is kept."
              : "We couldn't accept your message. Please check your entries and try again.")
        );
        focusFirst(mapped);
        return;
      }
      throw new Error("server");
    } catch {
      setStatus("error");
      setFormError(
        "Sorry, something went wrong on our side and your message was not sent. Your text is still here, so please try again in a moment."
      );
    }
  }

  if (status === "success") {
    return (
      <div className="cf-root">
        <style>{CSS}</style>
        <div className="cf-success" role="status">
          <h2 tabIndex={-1} ref={successRef}>Thank you, your message was sent</h2>
          <p>We'll get back to you by email as soon as we can.</p>
          <button type="button" className="cf-btn cf-secondary" onClick={() => setStatus("idle")}>
            Send another message
          </button>
        </div>
      </div>
    );
  }

  const fieldProps = (f: Field) => ({
    id: `${uid}-${f}`,
    name: f,
    value: values[f],
    disabled: busy,
    "aria-invalid": errors[f] ? (true as const) : undefined,
    "aria-describedby": errors[f] ? `${uid}-${f}-err` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(f, e.target.value),
    onBlur: () => blur(f),
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[f] = el; },
  });

  const Err = ({ f }: { f: Field }) =>
    errors[f] ? (
      <p className="cf-err" id={`${uid}-${f}-err`}>{errors[f]}</p>
    ) : null;

  return (
    <div className="cf-root">
      <style>{CSS}</style>
      <form onSubmit={onSubmit} noValidate aria-label="Contact us" className="cf-form">
        <h2 className="cf-title">Contact us</h2>
        <p className="cf-hint">Fields marked * are required.</p>

        {formError && (
          <div className="cf-alert" role="alert">{formError}</div>
        )}

        <div className={`cf-field${errors.name ? " has-err" : ""}`}>
          <label htmlFor={`${uid}-name`}>Name *</label>
          <input {...fieldProps("name")} type="text" autoComplete="name" required />
          <Err f="name" />
        </div>

        <div className={`cf-field${errors.email ? " has-err" : ""}`}>
          <label htmlFor={`${uid}-email`}>Email *</label>
          <input {...fieldProps("email")} type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" spellCheck={false} required />
          <Err f="email" />
        </div>

        <div className={`cf-field${errors.phone ? " has-err" : ""}`}>
          <label htmlFor={`${uid}-phone`}>Phone <span className="cf-opt">(optional)</span></label>
          <input {...fieldProps("phone")} type="tel" inputMode="tel" autoComplete="tel" />
          <Err f="phone" />
        </div>

        <div className={`cf-field${errors.message ? " has-err" : ""}`}>
          <label htmlFor={`${uid}-message`}>Message *</label>
          <textarea {...fieldProps("message")} rows={6} required />
          <div className="cf-count" aria-hidden="true">{values.message.length}/{MAX_MESSAGE}</div>
          <Err f="message" />
        </div>

        <button type="submit" className="cf-btn" disabled={busy} aria-disabled={busy}>
          {busy ? "Sending…" : status === "error" ? "Try again" : "Send message"}
        </button>
      </form>
    </div>
  );
}

const CSS = `
.cf-root{--fg:#1a1d23;--muted:#555b66;--bd:#8a909c;--accent:#1d4ed8;--err:#b3261e;--errbg:#fdecea;--bg:#fff;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);max-width:560px;margin:0 auto;padding:16px;box-sizing:border-box}
.cf-root *{box-sizing:border-box}
@media (prefers-color-scheme:dark){.cf-root{--fg:#eef0f4;--muted:#b0b6c2;--bd:#7d8493;--accent:#7aa2ff;--err:#ff8a80;--errbg:#3a1f1d;--bg:#14161b}}
.cf-title{font-size:1.5rem;margin:0 0 4px}
.cf-hint{margin:0 0 16px;color:var(--muted);font-size:.9rem}
.cf-field{margin-bottom:18px}
.cf-field label{display:block;font-weight:600;margin-bottom:6px}
.cf-opt{font-weight:400;color:var(--muted)}
.cf-field input,.cf-field textarea{width:100%;font:inherit;font-size:16px;/* 16px prevents iOS zoom */
  padding:12px;min-height:48px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg)}
.cf-field textarea{resize:vertical;min-height:140px}
.cf-field input:focus,.cf-field textarea:focus,.cf-btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.has-err input,.has-err textarea{border:2px solid var(--err)}
.cf-err{color:var(--err);margin:6px 0 0;font-size:.9rem}
.cf-err::before{content:"\\26A0\\00a0"}
.cf-count{text-align:right;font-size:.8rem;color:var(--muted);margin-top:4px}
.cf-alert{background:var(--errbg);color:var(--err);border:1px solid var(--err);border-radius:8px;padding:12px;margin-bottom:18px}
.cf-btn{width:100%;min-height:48px;padding:12px 20px;font:inherit;font-weight:600;border:0;border-radius:8px;
  background:var(--accent);color:#fff;cursor:pointer}
.cf-root .cf-btn:disabled{opacity:.7;cursor:progress}
.cf-secondary{background:transparent;color:var(--accent);border:2px solid var(--accent)}
.cf-success h2{margin:0 0 8px;font-size:1.4rem}
.cf-success h2:focus{outline:none}
.cf-success p{margin:0 0 16px}
@media (min-width:600px){.cf-btn{width:auto}}
@media (prefers-reduced-motion:no-preference){.cf-btn{transition:opacity .15s}}
`;
