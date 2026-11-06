import { useEffect, useRef, useState } from "react";

// Numbers count up when they change (spec §1). Integer cents in, integer
// cents out; instant under prefers-reduced-motion.
export default function useCountUp(target, ms = 600) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.current === target) { from.current = target; setValue(target); return; }
    const start = performance.now(), a = from.current, d = target - a;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(a + d * e));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
