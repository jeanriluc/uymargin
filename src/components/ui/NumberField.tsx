import { useState, type ReactNode } from "react";
import { formatDecimal, parseLocaleNumber } from "@/lib/format";

interface NumberFieldProps {
  id: string;
  label?: ReactNode;
  value: number;
  onChange: (value: number) => void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  hint?: ReactNode;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

function toDraft(value: number): string {
  return Number.isFinite(value) && value !== 0 ? formatDecimal(value) : "";
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  min = 0,
  max,
  placeholder = "0",
  className = "",
  inputClassName = "",
  disabled = false,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => toDraft(value));
  const [prevValue, setPrevValue] = useState(value);
  const [invalid, setInvalid] = useState(false);

  if (value !== prevValue) {
    setPrevValue(value);
    const parsed = parseLocaleNumber(draft);
    if (!(Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9) && !(draft === "" && value === 0)) {
      setDraft(toDraft(value));
    }
  }

  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
          <span>{label}</span>
        </label>
      )}
      <div className="relative flex items-center group">
        {prefix && (
          <span className="pointer-events-none absolute left-3.5 text-sm font-bold text-zinc-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors">
            {prefix}
          </span>
        )}
        <input
          id={id}
          name={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setInvalid(false);
            if (next.trim() === "") {
              onChange(0);
              return;
            }
            const parsed = parseLocaleNumber(next);
            if (Number.isFinite(parsed)) {
              const clamped = Math.min(max ?? Infinity, Math.max(min, parsed));
              setPrevValue(clamped);
              onChange(clamped);
            }
          }}
          onBlur={() => {
            const parsed = parseLocaleNumber(draft);
            if (draft.trim() !== "" && !Number.isFinite(parsed)) {
              setInvalid(true);
              return;
            }
            setDraft(toDraft(value));
          }}
          className={`h-11 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 num transition-all outline-none placeholder:text-zinc-400 hover:border-zinc-500 focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white disabled:opacity-50 ${
            prefix ? "pl-11" : ""
          } ${suffix ? "pr-16" : ""} ${invalid ? "border-red-600 focus:border-red-600 focus:ring-red-600" : ""} ${inputClassName}`}
        />
        {suffix && <div className="absolute right-2 flex items-center">{suffix}</div>}
      </div>
      {invalid ? (
        <p id={hintId} className="text-xs text-red-600 font-medium" aria-live="polite">
          Ingresá un número válido.
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-[11px] text-zinc-500 leading-tight">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
