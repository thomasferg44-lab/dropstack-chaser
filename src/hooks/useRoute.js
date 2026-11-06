import { useEffect, useState } from "react";

// A tiny path router (no dependency): five screens and one detail route.
//   /                 Today
//   /invoices         Invoices
//   /invoices/:id     Invoice detail (deep-linkable: lands with the record open)
//   /customers        Customers
//   /import           Import (CSV + Pull from Quote & Invoice)
//   /setup            Setup (business details, demo mode, status)
const listeners = new Set();
export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.scrollTo?.(0, 0);
  for (const l of listeners) l();
}

export function matchRoute(pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";
  let m;
  if (p === "/") return { name: "today" };
  if (p === "/invoices") return { name: "invoices" };
  if ((m = /^\/invoices\/([0-9a-f-]{36})$/i.exec(p))) return { name: "invoice", id: m[1] };
  if (p === "/customers") return { name: "customers" };
  if (p === "/import") return { name: "import" };
  if (p === "/setup") return { name: "setup" };
  return { name: "today", unknown: true };
}

export default function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    listeners.add(on);
    window.addEventListener("popstate", on);
    return () => { listeners.delete(on); window.removeEventListener("popstate", on); };
  }, []);
  return { path, ...matchRoute(path) };
}

/** <a> that routes in-app (keeps cmd-click / long-press open-in-new-tab working). */
export function linkProps(to) {
  return {
    href: to,
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
