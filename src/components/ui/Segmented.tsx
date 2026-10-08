import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  name: string;
  legend?: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  hideLegend?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  hideLegend = false,
  size = "md",
  className = "",
}: SegmentedProps<T>) {
  return (
    <fieldset className={`flex flex-col gap-1.5 ${className}`}>
      {legend && !hideLegend && (
        <legend className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          {legend}
        </legend>
      )}
      <div className="flex w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5">
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded font-bold uppercase transition-all cursor-pointer ${
                size === "sm" ? "py-1 px-2 text-[11px]" : "py-1.5 px-3 text-xs"
              } ${
                isSelected
                  ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
              }`}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface CurrencyToggleProps {
  name?: string;
  value: "UYU" | "USD";
  onChange: (value: "UYU" | "USD") => void;
  label?: string;
}

export function CurrencyToggle({ value, onChange }: CurrencyToggleProps) {
  return (
    <div className="flex rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5">
      <button
        type="button"
        onClick={() => onChange("UYU")}
        className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-all ${
          value === "UYU"
            ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
            : "text-zinc-500 hover:text-black dark:hover:text-white"
        }`}
      >
        $U
      </button>
      <button
        type="button"
        onClick={() => onChange("USD")}
        className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-all ${
          value === "USD"
            ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
            : "text-zinc-500 hover:text-black dark:hover:text-white"
        }`}
      >
        U$S
      </button>
    </div>
  );
}
