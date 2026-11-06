import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
import { wipeDevice } from "./lib/cache.js";
import { resetSchemaLevel } from "./lib/db.js";
import { annotate, buildTodayQueue } from "./lib/queue.js";
import { normaliseLadder } from "./lib/ladder.js";
import { hasDemo } from "./lib/demoData.js";
import { todayISO } from "./lib/dates.js";
import useRoute from "./hooks/useRoute.js";
import { DataProvider, useData } from "./state/DataStore.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";
import AppShell from "./components/AppShell.jsx";
import BrandMark from "./components/ui/BrandMark.jsx";
import Login from "./pages/Login.jsx";
import TodayPage from "./pages/TodayPage.jsx";
import InvoicesPage from "./pages/InvoicesPage.jsx";
import InvoiceDetailPage from "./pages/InvoiceDetailPage.jsx";
import CustomersPage from "./pages/CustomersPage.jsx";
import ImportPage from "./pages/ImportPage.jsx";
import SetupPage from "./pages/SetupPage.jsx";
import { companyConfig } from "../companyConfig.js";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") { wipeDevice(); resetSchemaLevel(); }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-md space-y-2">
          <h1 className="text-[17px] font-semibold">Supabase not configured</h1>
          <p className="text-[15px] text-ink-3">Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart.</p>
        </div>
      </div>
    );
  }
  // Brief neutral frame while the stored session is read (no spinner page).
  if (session === undefined) return <div className="min-h-screen aura-wash flex items-center justify-center"><BrandMark size={56} className="rounded-[16px] opacity-90" /></div>;
  if (!session) return <ToastProvider><Login /></ToastProvider>;

  return (
    <ToastProvider>
      <DataProvider key={session.user.id} user={session.user}>
        <Screens />
      </DataProvider>
    </ToastProvider>
  );
}

const TITLES = { today: "Today", invoices: "Invoices", invoice: "Invoice", customers: "Customers", import: "Import", setup: "Setup" };

function Screens() {
  const route = useRoute();
  const { invoices, schema } = useData();
  const today = todayISO();
  const badges = useMemo(() => {
    if (!invoices) return {};
    const ladder = normaliseLadder(companyConfig.ladder);
    return {
      queue: buildTodayQueue(annotate(invoices, { ladder, today })).length,
      open: invoices.filter((i) => i.status === "unpaid" || i.status === "partial").length,
    };
  }, [invoices, today]);
  useEffect(() => { document.title = `${TITLES[route.name]} · ${companyConfig.businessName}`; }, [route.name]);

  let page;
  switch (route.name) {
    case "invoices": page = <InvoicesPage key={route.path + window.location.search} />; break;
    case "invoice": page = <InvoiceDetailPage id={route.id} schema={schema} />; break;
    case "customers": page = <CustomersPage />; break;
    case "import": page = <ImportPage schema={schema} />; break;
    case "setup": page = <SetupPage schema={schema} />; break;
    default: page = <TodayPage schema={schema} />;
  }
  return (
    <AppShell route={route} title={TITLES[route.name]} badges={badges} demo={hasDemo(invoices ?? [])}
      back={route.name === "invoice" ? { to: "/invoices", label: "Invoices" } : null}>
      {page}
    </AppShell>
  );
}
