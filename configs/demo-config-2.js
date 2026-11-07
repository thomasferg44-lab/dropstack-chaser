// GATE 3 DEMO CONFIG 2: a second invented business, used to prove a config
// swap rebrands everything. Copy over companyConfig.js in a scratch build only.
// Everything client-specific lives here. Non-secret only — secrets go in .env.
// A new client deploy = swap this file, fresh Supabase project, new Netlify site.

// PLACEHOLDERS: every value below is invented and must be replaced per client.
// Emails deliberately use example.com, which IANA reserves permanently and
// publishes a null MX for, so a forgotten placeholder can never deliver mail to
// a real person. Do not use example.co.za or similar: those are registrable by
// anyone, so a stranger could start receiving your client's customer replies.

export const companyConfig = {
  businessName: "Example Coastal Electrical",
  ownerName: "Example Owner Two",
  currency: "ZAR", // ISO 4217 code. Display formatting only — storage is integer cents.
  locale: "en-ZA", // used by Intl for number/date formatting

  // Branding. primaryColor replaces the action blue on primary buttons (it
  // falls back to dark text automatically if white would be unreadable on it).
  // logoUrl "" shows a clean initials monogram instead of a logo.
  primaryColor: "#1F4E79",
  logoUrl: "",

  // Pay-from-the-nudge. Every nudge (both channels) ends with how to pay:
  // these instructions, the invoice reference, and the payment link if set.
  // paymentLink must be https:// (anything else is ignored). "" hides it.
  // PLACEHOLDER bank details: obviously fake so they can't be mistaken for real.
  paymentInstructions: "Example Mutual Bank · Account: Example Coastal Electrical · Acc no 1111 222 333 · Branch 444555",
  paymentLink: "https://pay.example.com/coastal-electrical",

  // Email sending (Netlify Function → Resend).
  // fromEmail's DOMAIN must be verified in Resend or every send is rejected.
  // Not a secret: the API key lives in .env, never here.
  fromEmail: "billing@example.org",
  fromName: "Example Coastal Electrical",
  replyToEmail: "owner-two@example.org", // where customer replies should land

  // Escalation ladder. Each stage becomes due `day` days after the due date
  // and uses that tone's template below. The owner still sends every nudge
  // with one tap: nothing here sends anything by itself.
  //   - the first nudge starts at the stage the invoice has reached, but
  //     never at the last (final) stage
  //   - after that each nudge moves up one stage
  //   - at least minDaysBetweenNudges days between nudges
  //   - a promise to pay pauses the ladder until the promised date has passed
  ladder: {
    stages: [
      { key: "reminder", label: "Reminder", day: 3, tone: "gentle" },
      { key: "overdue", label: "Overdue", day: 10, tone: "firm" },
      { key: "last", label: "Last notice", day: 21, tone: "final" },
    ],
    minDaysBetweenNudges: 4,
  },

  // "Pull from Quote & Invoice": accepted/invoiced quotes in the same Supabase
  // project become chaser invoices. Their due date is the acceptance (or
  // invoice) date plus paymentTermsDays. enabled: false hides the action.
  quotePull: {
    enabled: true,
    paymentTermsDays: 14,
  },

  // Demo mode: realistic sample books per trade, one tap to load or remove.
  // Set allowed: false once a client's real data is in.
  demo: {
    allowed: true,
    industries: ["electrician"],
  },

  // Nudge templates, one per tone per channel. The composer fills these in
  // from the invoice, so the owner never starts from a blank message.
  //   {customerName} {businessName} {ownerName} {reference} {dueDate}
  //   {daysOverdue} {amount} {invoiceTotal} {amountPaid}
  //   {jobPhrase}    " for the geyser replacement" (from the description)
  //   {paidLine}     " Thanks for the R 500,00 already paid." (part-paid only)
  //   {promiseLine}  what the customer promised before and what happened
  //   {payLine}      how to pay: instructions + reference + payment link
  //   {paymentDetails} the bare payment instructions (v1 placeholder)
  //
  // {amount} is the balance STILL OUTSTANDING, not the invoice total — on a
  // part-paid invoice those differ, so the wording says "outstanding"
  // throughout. A placeholder that resolves to nothing leaves no stray
  // blank line.
  nudgeTemplates: {
    whatsapp: {
      gentle:
        "Hi {customerName}, friendly reminder from {businessName}: invoice {reference}{jobPhrase} has {amount} outstanding, which was due on {dueDate}. It may well have slipped through — no stress if so.{paidLine}{promiseLine}\n\n{payLine}\n\nThank you, {ownerName}",
      firm:
        "Hi {customerName}, invoice {reference}{jobPhrase} from {businessName} is now {daysOverdue} days overdue (due {dueDate}), with {amount} still outstanding.{paidLine}{promiseLine}\n\nCould you let me know what date we can expect payment?\n\n{payLine}\n\n{ownerName}, {businessName}",
      final:
        "Hi {customerName}, this is a final reminder from {businessName} about invoice {reference}{jobPhrase}: {amount} remains outstanding and is now {daysOverdue} days overdue.{paidLine}{promiseLine}\n\nIf we don't receive payment or hear from you within 7 days, we'll pause any further work and refer the account for collection. If something is wrong with the invoice, please tell me and we'll sort it out.\n\n{payLine}\n\n{ownerName}, {businessName}",
    },
    email: {
      gentle: {
        subject: "Friendly reminder: invoice {reference} from {businessName}",
        body:
          "Hi {customerName},\n\nJust a friendly reminder that invoice {reference}{jobPhrase} has {amount} outstanding, which was due on {dueDate}. It may well have slipped through — no problem if so.{paidLine}{promiseLine}\n\n{payLine}\n\nThank you,\n{ownerName}\n{businessName}",
      },
      firm: {
        subject: "Overdue: invoice {reference} ({daysOverdue} days)",
        body:
          "Hi {customerName},\n\nInvoice {reference}{jobPhrase} is now {daysOverdue} days overdue — it was due on {dueDate}, and {amount} is still outstanding.{paidLine}{promiseLine}\n\nCould you please confirm the date on which payment will be made?\n\n{payLine}\n\nRegards,\n{ownerName}\n{businessName}",
      },
      final: {
        subject: "Final notice: invoice {reference}",
        body:
          "Hi {customerName},\n\nThis is a final notice regarding invoice {reference}{jobPhrase}. The outstanding balance of {amount} is now {daysOverdue} days overdue.{paidLine}{promiseLine}\n\nIf we do not receive payment, or hear from you, within 7 days, we will pause any further work and refer the account for collection.\n\nIf there is a problem with the invoice, please reply to this email and we will resolve it.\n\n{payLine}\n\nRegards,\n{ownerName}\n{businessName}",
      },
    },
  },
};
