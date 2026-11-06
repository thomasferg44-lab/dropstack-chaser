import { createContext, useCallback, useContext, useRef, useState } from "react";

// Toasts (spec §4): dark pill, bottom-centre, one short sentence, ~3s, no
// emoji, no exclamation marks. Optional single action (e.g. Undo/Discard).
const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, opts = {}) => {
    clearTimeout(timer.current);
    setToast({ message, action: opts.action, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), opts.duration ?? 3000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+96px)] sm:bottom-8 z-[60] flex justify-center pointer-events-none px-4">
        {toast && (
          <div key={toast.key} role="status" className="pointer-events-auto animate-rise flex items-center gap-3 rounded-full bg-chrome/95 text-white text-[15px] pl-5 pr-2 py-2 shadow-lift min-h-[44px] max-w-full">
            <span className="py-1">{toast.message}</span>
            {toast.action ? (
              <button type="button" onClick={() => { toast.action.onClick(); setToast(null); }}
                className="rounded-full px-3 min-h-[36px] font-semibold text-[#64d2ff] hover:bg-white/10">{toast.action.label}</button>
            ) : <span className="w-3" />}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
