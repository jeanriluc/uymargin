import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

interface InfoTipProps {
  label: string;
  children: ReactNode;
}

export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  return (
    <span className="relative inline-flex items-center ml-1 align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="tap-inline inline-flex size-4.5 cursor-help items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400 transition-colors hover:text-black dark:hover:text-white"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-72 max-w-[80vw] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5 text-xs font-normal normal-case tracking-normal leading-relaxed text-zinc-900 dark:text-zinc-100 shadow-xl pointer-events-none"
        >
          {children}
        </span>
      )}
    </span>
  );
}
