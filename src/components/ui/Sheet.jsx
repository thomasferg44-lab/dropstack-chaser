import { useEffect, useRef, useState } from "react";

// iOS-style sheet (design spec §4): grab handle, drag down to dismiss with a
// spring settle, backdrop tap and Escape close. Bottom sheet on phones,
// centred card on desktop.
export default function Sheet({ open = true, onClose, title, children, footer, labelledBy, wide = false }) {
  const panel = useRef(null);
  const start = useRef(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panel.current?.querySelector("[data-autofocus]")?.focus(), 260);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open, onClose]);

  useEffect(() => { if (open) setDy(0); }, [open]);
  if (!open) return null;

  const onDown = (e) => { if (e.target.closest("button")) return; start.current = e.clientY; setDragging(true); try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already-released pointer */ } };
  const onMove = (e) => { if (start.current != null) setDy(Math.max(0, e.clientY - start.current)); };
  const onUp = () => {
    setDragging(false);
    start.current = null;
    if (dy > 110) onClose?.(); else setDy(0);
  };

  const id = labelledBy ?? "sheet-title";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade" onClick={onClose} aria-hidden data-testid="sheet-backdrop" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id}
        className={`relative w-full ${wide ? "sm:max-w-xl" : "sm:max-w-md"} bg-white rounded-t-[22px] sm:rounded-card shadow-lift animate-sheet-up max-h-[92vh] flex flex-col`}
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: dragging ? "none" : "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
        <div className="pt-2.5 pb-1 flex justify-center touch-none cursor-grab sm:hidden" data-testid="sheet-handle"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="h-1.5 w-10 rounded-full bg-fill-2" aria-hidden />
        </div>
        <div className="px-5 pt-2 sm:pt-5 pb-2 flex items-start justify-between gap-3 touch-none"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <h2 id={id} className="text-[19px] font-semibold leading-tight pt-1.5">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 -mt-1 h-11 w-11 flex-shrink-0 inline-flex items-center justify-center rounded-full text-ink-3 hover:bg-fill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-hairline">{footer}</div>}
      </div>
    </div>
  );
}
