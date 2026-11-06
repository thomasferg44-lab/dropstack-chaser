// The composer: every nudge arrives WRITTEN for the owner. It picks the
// ladder stage's tone, fills the template from the customer's own data (job,
// balance, days overdue, part-payments, promises made and broken) and the
// pay-from-the-nudge block, then checks that what will be sent really carries
// the payment details. Deterministic: no network, no AI.
//
// Provider seam (unused in this pass, by design): composeNudge accepts an
// optional `refine(draft, context)` that returns { body, subject? }. A future
// generative drafter would plug in there, receiving the deterministic draft
// and the same context; its output still goes through the same pay check and
// the owner still reads and taps send. Nothing calls an AI API today.
import { renderNudge, buildNudgeVars } from "./nudge.js";
import { normaliseLadder } from "./ladder.js";
import { payCheck } from "./payInfo.js";

/** Tone for a stage key (or a tone passed directly). */
export function toneForStage(stageKey, config) {
  const ladder = normaliseLadder(config.ladder);
  const s = ladder.stages.find((x) => x.key === stageKey);
  if (s) return s.tone;
  if (["gentle", "firm", "final"].includes(stageKey)) return stageKey;
  return ladder.stages[0].tone;
}

/**
 * { channel, stage, tone, subject?, body, url?, to?, canSend, blockedReason,
 *   checks: { payConfigured, payIncluded, linkIncluded, referenceIncluded,
 *             amountIncluded, unresolved: ["{typo}"] } }
 */
export function composeNudge(invoice, { stage, channel, config, today, refine = null }) {
  const tone = toneForStage(stage, config);
  let nudge = renderNudge(invoice, { tone, channel, config, today });
  if (typeof refine === "function") {
    const out = refine({ body: nudge.body, subject: nudge.subject }, { invoice, stage, tone, channel, today });
    if (out?.body) nudge = { ...nudge, body: out.body, subject: out.subject ?? nudge.subject };
  }
  return { ...nudge, stage, checks: checkDraft(invoice, { body: nudge.body, subject: nudge.subject }, config, today) };
}

/** Run on the text as it stands (after any edit) before every send. */
export function checkDraft(invoice, { body, subject = "" }, config, today) {
  const vars = buildNudgeVars(invoice, config, today);
  const text = `${subject}\n${body}`;
  const pc = payCheck(config, invoice, text);
  return {
    payConfigured: pc.configured,
    payIncluded: pc.instructions !== false && pc.link !== false && pc.configured,
    linkIncluded: pc.link,
    referenceIncluded: pc.reference,
    amountIncluded: text.includes(vars.amount),
    unresolved: [...new Set(text.match(/\{\w+\}/g) ?? [])],
  };
}

/** Plain-language warnings for the composer, worst first. Empty = good to go. */
export function draftWarnings(checks) {
  const out = [];
  if (checks.unresolved.length) out.push(`The message still has ${checks.unresolved.join(", ")} in it. Fix the template in setup or edit it out.`);
  if (!checks.payConfigured) out.push("No payment details are set up, so this nudge can't say how to pay. Add them in setup.");
  else if (!checks.payIncluded) out.push("The payment details were edited out of this message.");
  if (checks.amountIncluded === false) out.push("The outstanding amount isn't in the message any more.");
  return out;
}
