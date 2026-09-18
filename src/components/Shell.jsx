import { supabase } from "../lib/supabase.js";
import { companyConfig } from "../../companyConfig.js";

const NAV = [
  { key: "dashboard", label: "Dashboard" },
  { key: "customers", label: "Customers" },
  { key: "import", label: "Import CSV" },
];

export default function Shell({ view, onNavigate, email, children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-surface/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
          <div className="font-semibold truncate">
            <span className="bg-linear-to-r from-accent-1 to-accent-2 bg-clip-text text-transparent">
              {companyConfig.businessName}
            </span>
          </div>
          <nav className="flex gap-1 ml-auto sm:ml-6">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => onNavigate(n.key)}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  view === n.key ? "bg-border text-text" : "text-mute hover:text-text"
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="hidden sm:flex items-center gap-3 ml-auto text-xs text-dim">
            <span className="truncate max-w-[12rem]">{email}</span>
            <button className="btn-ghost px-2 py-1" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      <footer className="sm:hidden border-t border-border p-3 text-center">
        <button className="btn-ghost text-xs" onClick={() => supabase.auth.signOut()}>Sign out ({email})</button>
      </footer>
    </div>
  );
}
