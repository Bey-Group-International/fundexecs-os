"use client";

import { useState } from "react";
import {
  APPLICANT_TYPES,
  APPLICANT_TYPE_DESC,
  APPLICANT_TYPE_LABEL,
  COMMON_FIELDS,
  FIELDS_BY_TYPE,
  NOTE_FIELD,
  type AccessRequestField,
  type ApplicantType,
} from "@/lib/access-request-fields";
import { requestAccess } from "./actions";

const FIELD_CLS =
  "rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-primary placeholder-fg-muted outline-none transition focus:border-gold-500 focus:bg-surface-2";

function Field({ field }: { field: AccessRequestField }) {
  const id = `arf-${field.name}`;
  const label = (
    <label className="text-xs text-fg-secondary" htmlFor={id}>
      {field.label}
      {field.required ? <span className="text-gold-300"> *</span> : null}
    </label>
  );

  if (field.kind === "select") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select id={id} name={field.name} required={field.required} className={FIELD_CLS} defaultValue="">
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === "textarea") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <textarea
          id={id}
          name={field.name}
          rows={3}
          required={field.required}
          placeholder={field.placeholder}
          className={`${FIELD_CLS} resize-y`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {label}
      <input
        id={id}
        name={field.name}
        type={field.kind === "number" ? "number" : "text"}
        min={field.kind === "number" ? 0 : undefined}
        required={field.required}
        placeholder={field.placeholder}
        className={FIELD_CLS}
      />
    </div>
  );
}

/**
 * The sign-up form. Which questions appear depends on who is asking, so the
 * applicant type is picked first and the rest of the form is rendered from
 * lib/access-request-fields.ts.
 *
 * Choosing a type remounts the type-specific block by key, so switching from
 * "GP" to "Advisory" doesn't leave a stale AUM answer behind in the DOM to be
 * posted with the wrong form. The server re-validates against the same schema
 * regardless — this is for the person filling it in, not for trust.
 */
export function RequestAccessForm({
  defaultEmail = "",
  defaultType = null,
}: {
  defaultEmail?: string;
  defaultType?: ApplicantType | null;
}) {
  const [type, setType] = useState<ApplicantType | null>(defaultType);

  return (
    <form action={requestAccess} className="mt-6 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs text-fg-secondary">
          Which best describes you?<span className="text-gold-300"> *</span>
        </legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {APPLICANT_TYPES.map((t) => {
            const selected = type === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={selected}
                className={
                  selected
                    ? "rounded-md border border-gold-500 bg-gold-500/10 px-3 py-2 text-left transition"
                    : "rounded-md border border-line bg-surface-2 px-3 py-2 text-left transition hover:border-line/80 hover:bg-surface-1"
                }
              >
                <p className="text-sm font-medium text-fg-primary">
                  {APPLICANT_TYPE_LABEL[t]}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">{APPLICANT_TYPE_DESC[t]}</p>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="applicant_type" value={type ?? ""} />
      </fieldset>

      {type ? (
        <div key={type} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-secondary" htmlFor="arf-full_name">
              Full name<span className="text-gold-300"> *</span>
            </label>
            <input
              id="arf-full_name"
              name="full_name"
              required
              placeholder="Alex Chen"
              autoComplete="name"
              className={FIELD_CLS}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-secondary" htmlFor="arf-email">
              Work email<span className="text-gold-300"> *</span>
            </label>
            <input
              id="arf-email"
              name="email"
              type="email"
              required
              defaultValue={defaultEmail}
              placeholder="you@yourfirm.com"
              autoComplete="email"
              className={FIELD_CLS}
            />
          </div>

          {COMMON_FIELDS.map((f) => (
            <Field key={f.name} field={f} />
          ))}
          {FIELDS_BY_TYPE[type].map((f) => (
            <Field key={f.name} field={f} />
          ))}
          <Field field={NOTE_FIELD} />

          <button
            type="submit"
            className="mt-2 rounded-md bg-gold-400 py-2.5 text-sm font-medium text-on-gold transition hover:opacity-90"
          >
            Request access
          </button>
          <p className="text-center text-xs text-fg-muted">
            No password yet — we review every request by hand and email you an
            invitation once your workspace is open.
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">
          Pick one above and we&apos;ll ask only what&apos;s relevant to you.
        </p>
      )}
    </form>
  );
}
