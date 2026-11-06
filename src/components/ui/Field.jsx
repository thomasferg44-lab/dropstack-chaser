import { useId } from "react";
import Icon from "./Icon.jsx";

// Form field per spec §2: label above (13px semibold), helper below in grey,
// inline error under the field in #b42318 with an icon AND words.
export function Field({ label, help, error, children, className = "", optional = false, id: idProp }) {
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = [help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}{optional && <span className="font-normal text-ink-3"> (optional)</span>}
        </label>
      )}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? "true" : undefined })}
      {error ? (
        <p id={`${id}-err`} className="field-error"><Icon name="alert" size={15} className="mt-[1px] flex-shrink-0" />{error}</p>
      ) : help ? (
        <p id={`${id}-help`} className="field-help">{help}</p>
      ) : null}
    </div>
  );
}

export function TextField({ label, help, error, optional, className, inputClassName = "", ...input }) {
  return (
    <Field label={label} help={help} error={error} optional={optional} className={className}>
      {(a) => <input {...a} {...input} className={`input ${inputClassName}`} />}
    </Field>
  );
}

// Money/number: right-aligned, tabular numerals, decimal keypad, optional
// prefix ("R") or suffix ("%", "m²").
export function NumberField({ label, help, error, prefix, suffix, className, ...input }) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      {(a) => (
        <div className="relative">
          {prefix && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">{prefix}</span>}
          <input {...a} type="text" inputMode="decimal" autoComplete="off" {...input}
            className={`input input-money ${prefix ? "pl-9" : ""} ${suffix ? "pr-12" : ""}`} />
          {suffix && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

// Quantity with thumb-sized steppers (>=44px), typed decimals still allowed.
export function StepperField({ label, error, value, onChange, onStep, unit, className, onBlur }) {
  return (
    <Field label={label} error={error} className={className}>
      {(a) => (
        <div className="flex items-stretch rounded-input border border-field bg-white overflow-hidden focus-within:border-action-fill focus-within:shadow-ring"
          data-invalid={error ? "true" : undefined} style={error ? { borderColor: "#b42318" } : undefined}>
          <button type="button" onClick={() => onStep(-1)} aria-label={`Decrease ${label}`}
            className="w-12 min-h-[48px] flex items-center justify-center text-ink-2 active:bg-fill"><Icon name="minus" /></button>
          <div className="relative flex-1 min-w-0">
            <input {...a} type="text" inputMode="decimal" autoComplete="off" value={value} onBlur={onBlur}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-full min-h-[48px] bg-transparent text-center tabular text-base outline-none px-1" />
          </div>
          {unit && <span className="self-center pr-1 text-[13px] text-ink-3">{unit}</span>}
          <button type="button" onClick={() => onStep(1)} aria-label={`Increase ${label}`}
            className="w-12 min-h-[48px] flex items-center justify-center text-ink-2 active:bg-fill"><Icon name="plus" /></button>
        </div>
      )}
    </Field>
  );
}

// iOS switch, whole row is the 44px+ target.
export function Switch({ checked, onChange, label, description, id, disabled }) {
  return (
    <label className={`flex items-center justify-between gap-4 min-h-[52px] ${disabled ? "opacity-50" : "cursor-pointer"}`} htmlFor={id}>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {description && <span className="block text-[13px] text-ink-3">{description}</span>}
      </span>
      <span className="relative flex-shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="block h-[31px] w-[51px] rounded-full bg-fill-2 transition-colors duration-200 peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-action-fill peer-focus-visible:ring-offset-2" />
        <span className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-out-soft peer-checked:translate-x-[20px]" />
      </span>
    </label>
  );
}

// Segmented control (mode pickers, deposit type).
export function Segmented({ options, value, onChange, label, scroll = false }) {
  return (
    <div role="radiogroup" aria-label={label}
      className={`flex gap-1 rounded-input bg-fill p-1 ${scroll ? "overflow-x-auto no-scrollbar" : ""}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-[9px] px-3 min-h-[44px] text-[14px] font-medium transition-all duration-200 ease-out-soft
              ${active ? "bg-white text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-2 hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
