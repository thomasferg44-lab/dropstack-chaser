import { companyConfig } from "../../companyConfig.js";
import BrandMark from "./ui/BrandMark.jsx";
import Icon from "./ui/Icon.jsx";
import useHealth from "../hooks/useHealth.js";
import { healthSummary } from "../lib/health.js";
import { linkProps } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";

const DOT = { good: "bg-[#34c759]", warn: "bg-[#ff9f0a]", bad: "bg-[#ff3b30]", unknown: "bg-ink-4" };

// Small status line driven by /api/health (database reachable, config present).
function StatusLine({ dark }) {
  const s = healthSummary(useHealth());
  return (
    <div role="status" aria-live="polite" data-testid="health-status" data-tone={s.tone} title={s.text}
      className={`flex items-center gap-2 text-[12px] ${dark ? "text-white/70" : "text-ink-3"}`}>
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${DOT[s.tone]}`} aria-hidden />
      <span className="truncate">{s.text}</span>
    </div>
  );
}

function SyncLine({ dark }) {
  const { offline, pending, lastSync } = useData();
  if (!offline && !pending) return null;
  const time = lastSync ? new Date(lastSync).toLocaleTimeString(companyConfig.locale, { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div role="status" data-testid="sync-status" className={`flex items-center gap-2 text-[12px] ${dark ? "text-white/70" : "text-warn"}`}>
      <Icon name="wifiOff" size={14} />
      <span className="truncate">
        {offline ? `Offline${time ? ` · showing ${time}` : ""}` : "Back online"}
        {pending ? ` · ${pending} to sync` : ""}
      </span>
    </div>
  );
}

export function DemoBadge({ className = "" }) {
  return <span className={`pill-warn ${className}`} data-testid="demo-badge" title="Demo data is loaded. Remove it in Setup.">DEMO</span>;
}

const NAV = [
  { to: "/", name: "today", label: "Today", icon: "inbox", badge: "queue" },
  { to: "/invoices", name: "invoices", label: "Invoices", icon: "invoice", badge: "open" },
  { to: "/customers", name: "customers", label: "Customers", icon: "users" },
  { to: "/import", name: "import", label: "Import", icon: "upload" },
  { to: "/setup", name: "setup", label: "Setup", icon: "settings" },
];

/**
 * The console shell, adapted (spec §1): dark charcoal glass sidebar with the
 * aura-tinted pill on the active item and live count badges on desktop; a
 * bottom tab bar on phones.
 */
export default function AppShell({ route, title, back, actions, badges = {}, demo = false, children }) {
  const active = route.name === "invoice" ? "invoices" : route.name;
  return (
    <div className="min-h-screen lg:pl-[248px]">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[248px] glass-chrome text-white flex-col z-30">
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <BrandMark size={34} className="rounded-[10px]" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate">{companyConfig.businessName}</div>
            <div className="text-[12px] text-white/60">Invoice Chaser</div>
          </div>
        </div>
        {demo && <div className="px-5 -mt-2 mb-3"><DemoBadge /></div>}
        <nav className="px-3 space-y-1" aria-label="Main">
          {NAV.map((n) => {
            const on = active === n.name;
            const count = n.badge ? badges[n.badge] : 0;
            return (
              <a key={n.to} {...linkProps(n.to)} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 rounded-[12px] px-3 min-h-[44px] text-[15px] transition-colors duration-200 ${on ? "aura-pill text-white font-semibold" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
                <Icon name={n.icon} />
                <span className="flex-1">{n.label}</span>
                {count > 0 && (
                  <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-white/90 text-chrome text-[12px] font-semibold tabular inline-flex items-center justify-center"
                    aria-label={`${count} ${n.badge === "queue" ? "to chase today" : "unpaid"}`}>{count}</span>
                )}
              </a>
            );
          })}
        </nav>
        <div className="mt-auto px-5 py-5 space-y-2">
          <SyncLine dark />
          <StatusLine dark />
          <div className="text-[12px] text-white/60">Powered by DropStack</div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 aura-wash glass-light border-b border-hairline">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-[56px] flex items-center gap-2">
          {back ? (
            <a {...linkProps(back.to)} className="-ml-2 inline-flex items-center gap-0.5 min-h-[44px] pr-2 text-action text-[15px]">
              <Icon name="chevronLeft" /> {back.label}
            </a>
          ) : (
            <span className="lg:hidden flex items-center gap-2 min-w-0"><BrandMark size={28} className="rounded-[8px]" /></span>
          )}
          <h1 className="flex-1 min-w-0 truncate text-[17px] font-semibold">{title}</h1>
          {demo && <DemoBadge className="lg:hidden" />}
          {actions}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-32 lg:pb-12">
        <div className="lg:hidden mb-3"><SyncLine /></div>
        {children}
        <div className="lg:hidden mt-8 flex flex-col items-center gap-1"><StatusLine /><span className="text-[12px] text-ink-3">Powered by DropStack</span></div>
      </main>

      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass-white border-t border-hairline pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {NAV.map((n) => {
            const on = active === n.name;
            const count = n.badge ? badges[n.badge] : 0;
            return (
              <a key={n.to} {...linkProps(n.to)} aria-current={on ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${on ? "text-action" : "text-ink-3"}`}>
                <span className="relative">
                  <Icon name={n.icon} size={24} />
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[11px] font-semibold tabular inline-flex items-center justify-center">{count}</span>
                  )}
                </span>
                {n.label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
