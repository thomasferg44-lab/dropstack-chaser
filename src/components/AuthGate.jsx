import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { companyConfig } from "../../companyConfig.js";

export default function AuthGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm flex flex-col gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-dim">Invoice Chaser</div>
          <h1 className="text-lg font-semibold">{companyConfig.businessName}</h1>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-status-critical text-sm">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-xs text-dim">No public signup. Your login is created by DropStack.</p>
      </form>
    </div>
  );
}
