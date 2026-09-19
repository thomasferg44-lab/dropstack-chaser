import { useEffect, useMemo, useState } from "react";
import { TONES, CHANNELS, renderNudge } from "../lib/nudge.js";
import { waLink } from "../lib/phone.js";
import { sendNudgeEmail } from "../lib/email.js";
import { formatCents, outstandingCents } from "../lib/money.js";
import { formatDate, todayISO, daysOverdue } from "../lib/dates.js";
import { companyConfig } from "../../companyConfig.js";
import Modal from "./Modal.jsx";

/**
 * Pick a tone, read exactly what will be sent, then send it.
 *
 * WhatsApp opens a wa.me draft in the owner's own WhatsApp — nothing leaves
 * this app, and the owner still presses send themselves. Email delivery via
 * Resend is wired in the next stage; for now the rendered email can be copied.
 */
export default function NudgeSheet({ invoice, onClose, onSent }) {
  const [tone, setTone] = useState("gentle");
  const [channel, setChannel] = useState(invoice.customer?.phone ? "whatsapp" : "email");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const { locale } = companyConfig;

  // A broken template is a config error: surface it, never send a blank message.
  const { nudge, renderError } = useMemo(() => {
    try {
      return { nudge: renderNudge(invoice, { tone, channel, config: companyConfig, today }), renderError: null };
    } catch (e) {
      return { nudge: null, renderError: e.message };
    }
  }, [invoice, tone, channel, today]);

  // Changing tone or channel replaces the draft; a manual edit is kept until then.
  useEffect(() => {
    if (nudge) {
      setText(nudge.body);
      setSubject(nudge.subject || "");
      setEdited(false);
      setCopied(false);
      setNotice(null);
      setError(null);
    }
  }, [nudge]);

  const body = edited ? text : nudge?.body || "";
  const days = daysOverdue(invoice.due_on, today);

  async function send() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (channel === "whatsapp") {
        // Rebuilt from the (possibly edited) text the owner just read.
        window.open(waLink(invoice.customer?.phone, body), "_blank", "noopener");
      } else {
        const result = await sendNudgeEmail({
          to: nudge.to,
          subject,
          body,
          tone,
          invoiceId: invoice.id,
        });
        // Blocked means nothing was sent, so nothing is recorded either.
        if (!result.sent) {
          setNotice(result.reason || "Nothing was sent.");
          setBusy(false);
          return;
        }
      }
      await onSent({ invoiceId: invoice.id, channel, tone });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function copy() {
    const payload = channel === "email" ? `Subject: ${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the text and copy manually.");
    }
  }

  return (
    <Modal title={`Nudge ${invoice.customer?.name || ""}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-sm text-mute">
          <span className="text-text font-semibold tabular-nums">
            {formatCents(outstandingCents(invoice), invoice.currency, locale)}
          </span>{" "}
          owed on {invoice.reference || "this invoice"} · due {formatDate(invoice.due_on, locale)}
          {days > 0 && <> · <span className="text-status-due">{days} days overdue</span></>}
        </div>

        <div className="field">
          <label>Tone</label>
          <div className="grid grid-cols-3 gap-2">
            {TONES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTone(t.key)}
                aria-pressed={tone === t.key}
                className={`rounded-lg border p-2 text-left transition ${
                  tone === t.key ? "border-accent-1 bg-border/50" : "border-border hover:border-dim"
                }`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[10px] text-dim leading-tight">{t.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Channel</label>
          <div className="flex gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                aria-pressed={channel === c.key}
                className={`flex-1 rounded-lg border p-2 text-sm font-medium transition ${
                  channel === c.key ? "border-accent-1 bg-border/50" : "border-border hover:border-dim"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {nudge && (
          <div className="field">
            <label>Preview {edited && <span className="text-dim">· edited</span>}</label>
            {channel === "email" && (
              <>
                <div className="text-xs text-mute mb-1">To: {nudge.to || "—"}</div>
                <input
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); setEdited(true); }}
                  aria-label="Subject"
                  className="mb-2"
                />
              </>
            )}
            <textarea
              rows={channel === "email" ? 10 : 6}
              value={body}
              onChange={(e) => { setText(e.target.value); setEdited(true); }}
              className="font-normal leading-relaxed"
            />
            <div className="text-[11px] text-dim">
              Edit it if you like — what you see is exactly what gets sent.
            </div>
          </div>
        )}

        {nudge && !nudge.canSend && (
          <p className="text-status-due text-sm">{nudge.blockedReason}</p>
        )}
        {(error || renderError) && <p className="text-status-critical text-sm">{error || renderError}</p>}
        {notice && (
          <p className="text-status-due text-sm">
            {notice} Nothing was recorded against this invoice.
          </p>
        )}

        {channel === "email" && (
          <p className="text-xs text-dim">
            Sent from {companyConfig.fromEmail} via Resend. Replies go to {companyConfig.replyToEmail || "your reply-to address"}.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={copy}>
            {copied ? "Copied" : "Copy text"}
          </button>
          <button type="button" className="btn-primary" disabled={!nudge?.canSend || busy} onClick={send}>
            {channel === "whatsapp"
              ? busy ? "Opening…" : "Open WhatsApp"
              : busy ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
