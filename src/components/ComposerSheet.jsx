import { useEffect, useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { Segmented } from "./ui/Field.jsx";
import { useToast } from "./ui/Toast.jsx";
import { composeNudge, checkDraft, draftWarnings } from "../lib/compose.js";
import { normaliseLadder, ladderState } from "../lib/ladder.js";
import { waLink } from "../lib/phone.js";
import { sendNudgeEmail } from "../lib/email.js";
import { summariseNudges, overNudgeWarning, describeNudge } from "../lib/nudgeHistory.js";
import { promiseState, promiseLabel } from "../lib/promises.js";
import { formatCents, outstandingCents } from "../lib/money.js";
import { formatDate, todayISO, daysOverdue } from "../lib/dates.js";
import { saveDraft, loadDraft, clearDrafts } from "../lib/cache.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

/**
 * The composer. The nudge arrives written: the ladder's stage and tone, the
 * customer's job, balance, part-payments and promises, and how to pay. The
 * owner reads it, optionally tweaks it, and taps once. Edits are saved on the
 * device as they type, so a dropped connection or closed tab loses nothing.
 *
 * WhatsApp opens a wa.me draft in the owner's own WhatsApp: nothing is sent
 * by this app, the owner presses send there. Email goes through the send
 * function (Resend) and only counts as sent when it really was.
 */
export default function ComposerSheet({ invoice, initialStage, onClose }) {
  const { user, recordNudge } = useData();
  const toast = useToast();
  const today = todayISO();
  const { locale } = companyConfig;
  const ladder = useMemo(() => normaliseLadder(companyConfig.ladder), []);
  const ls = useMemo(() => ladderState(invoice, { ladder, today }), [invoice, ladder, today]);
  const defaultStage = initialStage ?? ls.nextStage?.key ?? ladder.stages[Math.max(0, ls.lastIndex)].key;
  const [stage, setStage] = useState(defaultStage);
  const [channel, setChannel] = useState(invoice.customer?.phone ? "whatsapp" : invoice.customer?.email ? "email" : "whatsapp");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const { nudge, renderError } = useMemo(() => {
    try { return { nudge: composeNudge(invoice, { stage, channel, config: companyConfig, today }), renderError: null }; }
    catch (e) { return { nudge: null, renderError: e.message }; }
  }, [invoice, stage, channel, today]);

  // Fresh draft per stage/channel, unless an unsent edit is saved on this device.
  useEffect(() => {
    if (!nudge) return;
    const saved = loadDraft(user.id, invoice.id, channel, stage);
    if (saved && (saved.body !== nudge.body || (saved.subject ?? "") !== (nudge.subject ?? ""))) {
      setBody(saved.body); setSubject(saved.subject ?? nudge.subject ?? ""); setRestored(true);
    } else {
      setBody(nudge.body); setSubject(nudge.subject ?? ""); setRestored(false);
    }
    setNotice(null); setError(null);
  }, [nudge, user.id, invoice.id, channel, stage]);

  const edit = (b, s = subject) => {
    setBody(b); setSubject(s);
    saveDraft(user.id, invoice.id, channel, stage, { body: b, subject: s });
  };
  const useFresh = () => { clearDrafts(user.id, invoice.id); setBody(nudge.body); setSubject(nudge.subject ?? ""); setRestored(false); };

  const checks = nudge ? checkDraft(invoice, { body, subject }, companyConfig, today) : null;
  const warnings = checks ? draftWarnings(checks) : [];
  const history = useMemo(() => summariseNudges(invoice.nudges, today), [invoice.nudges, today]);
  const overNudge = overNudgeWarning(history, invoice.customer?.name);
  const ps = promiseState(invoice, invoice.promises, today);
  const days = daysOverdue(invoice.due_on, today);
  const stageObj = ladder.stages.find((s) => s.key === stage);
  const isDemo = Boolean(invoice.is_demo);

  async function send() {
    setBusy(true); setError(null); setNotice(null);
    try {
      let demoEmail = false;
      if (channel === "whatsapp") {
        window.open(waLink(invoice.customer?.phone, body), "_blank", "noopener");
      } else if (isDemo) {
        demoEmail = true; // demo invoice: shown, never sent
      } else {
        const result = await sendNudgeEmail({ to: nudge.to, subject, body, tone: stageObj.tone, invoiceId: invoice.id, stage });
        if (!result.sent) { setNotice(result.reason || "Nothing was sent."); setBusy(false); return; }
      }
      const { queued } = await recordNudge({ invoice, channel, tone: stageObj.tone, stage });
      clearDrafts(user.id, invoice.id);
      const after = ladderState({ ...invoice, nudges: [...(invoice.nudges ?? []), { stage, tone: stageObj.tone, sent_at: new Date().toISOString() }] }, { ladder, today });
      const next = after.complete ? "Ladder finished. Call them next." : `Next nudge ${formatDate(after.nextDueOn, locale)}.`;
      toast(queued ? "Saved on this phone. It will sync when you're back online." : demoEmail ? `Demo invoice: email not sent, logged. ${next}` : `Logged. ${next}`);
      onClose(true);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const blocked = nudge && !nudge.canSend;
  const footer = (
    <div className="space-y-2">
      {channel === "email" && !isDemo && (
        <p className="text-[12px] text-ink-3 text-center">From {companyConfig.fromName} &lt;{companyConfig.fromEmail}&gt; · replies go to {companyConfig.replyToEmail || companyConfig.fromEmail}</p>
      )}
      {channel === "email" && isDemo && <p className="text-[12px] text-ink-3 text-center">Demo invoice: the email is shown here and logged, never sent.</p>}
      <button type="button" className="btn-primary w-full text-[17px]" disabled={!nudge || blocked || busy || !body.trim()} onClick={send} data-testid="composer-send">
        <Icon name={channel === "whatsapp" ? "chat" : "send"} />
        {channel === "whatsapp" ? (busy ? "Opening…" : "Open WhatsApp") : busy ? "Sending…" : "Send email"}
      </button>
    </div>
  );

  return (
    <Sheet onClose={() => onClose(false)} title={`Nudge ${invoice.customer?.name ?? ""}`} footer={footer} wide>
      <div className="space-y-4">
        <div className="rounded-[14px] bg-fill px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-ink-3 truncate">{invoice.reference || "No reference"} · due {formatDate(invoice.due_on, locale)}</div>
            <div className="text-[13px] font-medium">{days > 0 ? `${days} day${days === 1 ? "" : "s"} overdue` : days === 0 ? "Due today" : `Due in ${-days} days`}</div>
          </div>
          <div className="text-[20px] font-semibold tabular">{formatCents(outstandingCents(invoice), invoice.currency, locale)}</div>
        </div>

        {ps.state === "broken" && (
          <p className="pill-bad !h-auto py-1.5 !whitespace-normal w-full justify-start"><Icon name="alert" size={15} />{promiseLabel(ps, locale)}{ps.promise.note ? ` · “${ps.promise.note}”` : ""}</p>
        )}
        {overNudge && (
          <div className="rounded-[14px] bg-warn-soft text-warn px-4 py-3 text-[14px]" role="note">
            <div className="font-semibold">{overNudge}</div>
            <div className="text-[13px] mt-0.5">You can still send. This is a heads-up, not a block.</div>
          </div>
        )}

        <div>
          <div className="field-label">Ladder stage</div>
          <Segmented label="Ladder stage" value={stage} onChange={setStage}
            options={ladder.stages.map((s) => ({ value: s.key, label: s.key === ls.nextStage?.key ? `${s.label} · due` : s.label }))} />
        </div>
        <div>
          <div className="field-label">Send by</div>
          <Segmented label="Channel" value={channel} onChange={setChannel}
            options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} />
        </div>

        {renderError && <p className="field-error"><Icon name="alert" size={15} />{renderError}</p>}

        {nudge && (
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="nudge-body" className="field-label">Message, ready to send</label>
              {restored && <button type="button" className="btn-plain !min-h-[36px] !px-2 text-[13px]" onClick={useFresh}>Use fresh draft</button>}
            </div>
            {restored && <p className="text-[13px] text-ink-3 mb-1.5">Restored your unsent edit from this phone.</p>}
            {channel === "email" && (
              <>
                <div className="text-[13px] text-ink-3 mb-1">To: {nudge.to || "no email address"}</div>
                <input className="input mb-2" aria-label="Subject" value={subject} onChange={(e) => edit(body, e.target.value)} />
              </>
            )}
            <textarea id="nudge-body" data-testid="nudge-body" className="input" rows={channel === "email" ? 12 : 10} value={body} onChange={(e) => edit(e.target.value)} />
            <p className="field-help">What you see is exactly what gets sent. Tweak it if you like.</p>
          </div>
        )}

        {checks && (
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[13px]" aria-label="Checks before sending" data-testid="draft-checks">
            <Check ok={checks.amountIncluded} label="Balance included" />
            <Check ok={checks.payIncluded} label={checks.payConfigured ? "How to pay included" : "No payment details set up"} />
            <Check ok={checks.referenceIncluded !== false} label="Invoice reference included" />
          </ul>
        )}
        {warnings.map((w) => <p key={w} className="field-error"><Icon name="alert" size={15} />{w}</p>)}
        {blocked && <p className="field-error" role="alert"><Icon name="alert" size={15} />{nudge.blockedReason}</p>}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
        {notice && <p className="rounded-[12px] bg-warn-soft text-warn px-3 py-2 text-[14px]" role="alert">{notice} Nothing was logged against this invoice.</p>}

        {history.count > 0 && (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-ink-3 min-h-[44px] flex items-center">Previous nudges ({history.count})</summary>
            <ul className="mt-1 space-y-1 text-[13px] text-ink-2">
              {history.history.slice(0, 6).map((n) => <li key={n.id || n.sent_at}>{describeNudge(n, locale)}</li>)}
            </ul>
          </details>
        )}
      </div>
    </Sheet>
  );
}

function Check({ ok, label }) {
  return (
    <li className={`flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 ${ok ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>
      <Icon name={ok ? "check" : "alert"} size={15} /> {label}
    </li>
  );
}
