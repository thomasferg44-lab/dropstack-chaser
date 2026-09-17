import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
import AuthGate from "./components/AuthGate.jsx";
import Shell from "./components/Shell.jsx";
import InvoicesPage from "./pages/InvoicesPage.jsx";
import CustomersPage from "./pages/CustomersPage.jsx";
import ImportPage from "./pages/ImportPage.jsx";

// Views are a plain state switch for now. A router isn't needed until the
// hosted dashboard at "/" (Stage 4) and it stays one page anyway.
const VIEWS = {
  invoices: InvoicesPage,
  customers: CustomersPage,
  import: ImportPage,
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [view, setView] = useState("invoices");

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-md">
          <h1 className="font-semibold mb-2">Supabase not configured</h1>
          <p className="text-mute text-sm">
            Copy <code>.env.example</code> to <code>.env</code> and set{" "}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart{" "}
            <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-dim">Loading…</div>;
  }
  if (!session) return <AuthGate />;

  const View = VIEWS[view];
  return (
    <Shell view={view} onNavigate={setView} email={session.user.email}>
      <View onNavigate={setView} />
    </Shell>
  );
}
