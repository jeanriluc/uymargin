import type { ReactNode } from "react";

interface StepHeaderProps {
  /** Two-digit step number. Omit for optional blocks outside the main sequence. */
  step?: string;
  title: ReactNode;
  aside?: ReactNode;
  id?: string;
}

export function StepHeader({ step, title, aside, id }: StepHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {step && (
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center bg-black text-white dark:bg-white dark:text-black text-xs font-black"
          >
            {step}
          </span>
        )}
        <h2
          id={id}
          className="heading-grotesk min-w-0 text-sm font-black tracking-tight uppercase text-zinc-900 dark:text-zinc-100"
        >
          {step && <span className="visually-hidden">Paso {Number(step)}: </span>}
          {title}
        </h2>
      </div>
      {aside && (
        <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
          {aside}
        </span>
      )}
    </div>
  );
}
