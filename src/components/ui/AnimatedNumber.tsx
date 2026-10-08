import { useEffect, useRef, useState } from "react";

/** Smoothly tweens a number toward `target` */
export function useAnimatedNumber(target: number, durationMs = 350): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const displayRef = useRef(target);

  useEffect(() => {
    const from = displayRef.current;
    fromRef.current = from;
    if (from === target || !Number.isFinite(target)) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const display = useAnimatedNumber(value);
  return (
    <span className={`num ${className ?? ""}`} aria-label={format(value)}>
      <span aria-hidden>{format(display)}</span>
    </span>
  );
}
