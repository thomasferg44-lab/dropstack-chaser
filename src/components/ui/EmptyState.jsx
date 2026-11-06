import Icon from "./Icon.jsx";

// Designed empty state (spec §3): soft aura wash, one line icon, one
// sentence, ONE primary action. An empty state teaches; it's not an error.
export default function EmptyState({ icon = "inbox", title, children, action, secondary }) {
  return (
    <div className="card aura-wash px-6 py-10 text-center flex flex-col items-center gap-3 animate-rise">
      <span className="h-12 w-12 rounded-full bg-white shadow-card inline-flex items-center justify-center text-action"><Icon name={icon} size={24} /></span>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children && <p className="text-[15px] text-ink-3 max-w-sm">{children}</p>}
      {action && <div className="w-full sm:w-auto mt-2">{action}</div>}
      {secondary && <div className="mt-1">{secondary}</div>}
    </div>
  );
}
