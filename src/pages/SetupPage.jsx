import { useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import BrandMark from "../components/ui/BrandMark.jsx";
import DemoSheet from "../components/DemoSheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { confirmKey } from "../components/Checklist.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { plural } from "../components/InvoiceBits.jsx";
import useHealth from "../hooks/useHealth.js";
import { navigate } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { supabase } from "../lib/supabase.js";
import { wipeDevice, prefs } from "../lib/cache.js";
import { buildPayLine, safePaymentLink, paymentInstructions } from "../lib/payInfo.js";
import { normaliseLadder } from "../lib/ladder.js";
import { DEMO_INDUSTRIES, demoIndustryOf, hasDemo } from "../lib/demoData.js";
import { healthSummary } from "../lib/health.js";
import { companyConfig } from "../../companyConfig.js";

/**
 * Setup: the business details every nudge is written from (read from the
 * client's config, set up by DropStack), demo mode, and system status.
 */
export default function SetupPage({ schema }) {
  const { user, invoices, removeDemo } = useData();
  const toast = useToast();
  const health = useHealth();
  const [confirmed, setConfirmed] = useState(() => Boolean(prefs.get(confirmKey(user.id))));
  const [sheet, setSheet] = useState(null);
  const ladder = normaliseLadder(companyConfig.ladder);
  const payLine = buildPayLine(companyConfig, { reference: "INV-1042" });
  const demoOn = hasDemo(invoices ?? []);
  const industry = demoIndustryOf(invoices ?? []);
  const demoCount = (invoices ?? []).filter((i) => i.is_demo).length;
  const canDemo = companyConfig.demo?.allowed !== false;

  function confirm() {
    prefs.set(confirmKey(user.id), true);
    setConfirmed(true);
    toast("Details confirmed.");
    navigate("/");
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="biz-h">
        <h2 id="biz-h" className="section-label">Your business</h2>
        <div className="group-list">
          <Row label="Business name"><span className="flex items-center gap-2"><BrandMark size={24} className="rounded-[7px]" />{companyConfig.businessName}</span></Row>
          <Row label="Signs nudges as">{companyConfig.ownerName}</Row>
          <Row label="Brand colour"><span className="inline-flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-brand" aria-hidden />{companyConfig.primaryColor}</span></Row>
        </div>
      </section>

      <section aria-labelledby="pay-h">
        <h2 id="pay-h" className="section-label">How customers pay you</h2>
        <div className="card p-4 space-y-3">
          {payLine ? (
            <>
              <p className="text-[13px] text-ink-3">Every nudge ends with this, in both WhatsApp and email:</p>
              <pre className="whitespace-pre-wrap font-sans text-[15px] rounded-[12px] bg-fill px-3.5 py-3" data-testid="setup-payline">{payLine}</pre>
            </>
          ) : (
            <p className="field-error"><Icon name="alert" size={15} />No payment details yet. Nudges can't say how to pay until they're added.</p>
          )}
          {!safePaymentLink(companyConfig.paymentLink) && <p className="text-[13px] text-ink-3">No online payment link. Add one (Yoco, PayFast, SnapScan or your bank's pay link) and it appears as a tap-to-pay line.</p>}
          {/0{6,}/.test(paymentInstructions(companyConfig)) && <p className="text-[13px] text-warn">These look like placeholder bank details. Send DropStack your real ones before you chase anyone.</p>}
        </div>
      </section>

      <section aria-labelledby="email-h">
        <h2 id="email-h" className="section-label">Email nudges</h2>
        <div className="group-list">
          <Row label="Sent from">{companyConfig.fromName} &lt;{companyConfig.fromEmail}&gt;</Row>
          <Row label="Replies go to">{companyConfig.replyToEmail || companyConfig.fromEmail}</Row>
        </div>
      </section>

      <section aria-labelledby="ladder-h">
        <h2 id="ladder-h" className="section-label">Nudge ladder</h2>
        <div className="group-list">
          {ladder.stages.map((s) => (
            <Row key={s.key} label={s.label}>{s.day === 0 ? "On the due date" : `${plural(s.day, "day")} after it's due`}</Row>
          ))}
          <Row label="Breathing room">At least {plural(ladder.minDaysBetweenNudges, "day")} between nudges</Row>
        </div>
        <p className="text-[13px] text-ink-3 mt-2 px-1">You tap send on every nudge. Nothing is ever sent automatically.</p>
      </section>

      <div className="space-y-2">
        {confirmed ? (
          <p className="text-[15px] text-good flex items-center gap-2 px-1"><Icon name="check" size={18} />You've checked these details.</p>
        ) : (
          <button className="btn-primary w-full text-[17px]" onClick={confirm} data-testid="setup-confirm">These details are right</button>
        )}
        <p className="text-[13px] text-ink-3 px-1">Something wrong? WhatsApp DropStack and we'll change it for you.</p>
      </div>

      {canDemo && (
        <section aria-labelledby="demo-h">
          <h2 id="demo-h" className="section-label">Demo mode</h2>
          <div className="card p-4 space-y-3" data-testid="setup-demo">
            {schema !== "v2" ? (
              <p className="text-[15px] text-ink-3">Demo mode needs the November database update.</p>
            ) : demoOn ? (
              <>
                <p className="text-[15px]"><span className="pill-warn mr-2">DEMO</span>{plural(demoCount, "demo invoice")}{industry ? ` (${DEMO_INDUSTRIES[industry].label.toLowerCase()})` : ""} loaded.</p>
                <button className="btn-danger w-full sm:w-auto" onClick={() => setSheet("remove")} data-testid="demo-remove">Remove demo data</button>
              </>
            ) : (
              <>
                <p className="text-[15px] text-ink-3">Load a realistic set of books for a plumber, landscaper or electrician to see the tool working. One tap removes it all again.</p>
                <button className="btn-secondary w-full sm:w-auto" onClick={() => setSheet("demo")}>Load demo data</button>
              </>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="status-h">
        <h2 id="status-h" className="section-label">System status</h2>
        <div className="group-list" data-testid="setup-health">
          <Row label="Overall">{healthSummary(health).text}</Row>
          {health && !health.error && (
            <>
              <Row label="Database"><Yes ok={health.database} /></Row>
              <Row label="Payment details"><Yes ok={health.config.paymentInstructions || health.config.paymentLink} /></Row>
              <Row label="Email sender"><Yes ok={health.config.fromEmail} /></Row>
              <Row label="Real email sending"><Yes ok={health.functions?.realSendsEnabled} no="Test mode" /></Row>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="acct-h">
        <h2 id="acct-h" className="section-label">Account</h2>
        <div className="group-list">
          <Row label="Signed in as">{user.email}</Row>
          <button className="group-row w-full text-left text-bad" onClick={() => { wipeDevice(); supabase.auth.signOut(); }}><Icon name="logout" />Sign out</button>
        </div>
        <p className="text-[13px] text-ink-3 mt-2 px-1">Signing out clears your customers' details and any unsent drafts from this phone.</p>
      </section>

      {sheet === "demo" && <DemoSheet onClose={() => setSheet(null)} />}
      {sheet === "remove" && (
        <ConfirmSheet title="Remove demo data?" confirmLabel="Remove demo data" danger onClose={() => setSheet(null)}
          onConfirm={async () => { const r = await removeDemo(); toast(`Demo removed: ${plural(r.invoices_removed, "invoice")}.`); }}>
          <p>Every row marked DEMO is deleted: {plural(demoCount, "invoice")}, their customers, nudges and promises. Your real invoices aren't touched.</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="group-row justify-between">
      <span className="text-[15px] text-ink-3 flex-shrink-0">{label}</span>
      <span className="text-[15px] text-right min-w-0 break-words">{children}</span>
    </div>
  );
}
function Yes({ ok, no = "Not set" }) {
  return ok ? <span className="pill-good">Yes</span> : <span className="pill-warn">{no}</span>;
}
