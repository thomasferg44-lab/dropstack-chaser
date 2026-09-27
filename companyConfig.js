// Everything client-specific lives here. Non-secret only — secrets go in .env.
// A new client deploy = swap this file, fresh Supabase project, new Netlify site.

// PLACEHOLDERS: every value below is invented and must be replaced per client.
// Emails deliberately use example.com, which IANA reserves permanently and
// publishes a null MX for, so a forgotten placeholder can never deliver mail to
// a real person. Do not use example.co.za or similar: those are registrable by
// anyone, so a stranger could start receiving your client's customer replies.

export const companyConfig = {
  businessName: "Sample Service Co",
  ownerName: "Sample Owner",
  currency: "ZAR", // ISO 4217 code. Display formatting only — storage is integer cents.
  locale: "en-ZA", // used by Intl for number/date formatting

  // Bank details shown in nudge messages (leave blank to omit the line).
  paymentDetails: "",

  // Email sending (Netlify Function → Resend).
  // fromEmail's DOMAIN must be verified in Resend or every send is rejected.
  // Not a secret: the API key lives in .env, never here.
  fromEmail: "accounts@example.com",
  fromName: "Sample Service Co",
  replyToEmail: "owner@example.com", // where customer replies should land

  // Nudge templates. Placeholders: {customerName} {businessName} {amount}
  // {reference} {daysOverdue} {dueDate} {paymentDetails} {invoiceTotal} {amountPaid}
  //
  // {amount} is the balance STILL OUTSTANDING, not the invoice total — on a
  // part-paid invoice those differ, so the wording says "balance" throughout.
  // A placeholder that resolves to nothing (e.g. blank paymentDetails) leaves
  // no stray blank line. Used from the nudge sheet.
  nudgeTemplates: {
    whatsapp: {
      gentle:
        "Hi {customerName}, friendly reminder from {businessName}: invoice {reference} has an outstanding balance of {amount}, which was due on {dueDate}. It may well have slipped through — no stress if so.\n\n{paymentDetails}",
      firm:
        "Hi {customerName}, invoice {reference} from {businessName} is now {daysOverdue} days overdue (due {dueDate}), with {amount} still outstanding. Could you let me know what date we can expect payment?\n\n{paymentDetails}",
      final:
        "Hi {customerName}, this is a final reminder from {businessName} about invoice {reference}: {amount} remains outstanding and is now {daysOverdue} days overdue.\n\nIf we don't receive payment or hear from you within 7 days, we'll pause any further work and hand the account over for collection. If something is wrong with the invoice, please tell me and we'll sort it out.\n\n{paymentDetails}",
    },
    email: {
      gentle: {
        subject: "Friendly reminder: invoice {reference} from {businessName}",
        body:
          "Hi {customerName},\n\nJust a friendly reminder that invoice {reference} has an outstanding balance of {amount}, which was due on {dueDate}. It may well have slipped through — no problem if so.\n\n{paymentDetails}\n\nThanks,\n{businessName}",
      },
      firm: {
        subject: "Overdue: invoice {reference} ({daysOverdue} days)",
        body:
          "Hi {customerName},\n\nInvoice {reference} is now {daysOverdue} days overdue — it was due on {dueDate}, and {amount} is still outstanding.\n\nCould you please confirm the date on which payment will be made?\n\n{paymentDetails}\n\nRegards,\n{businessName}",
      },
      final: {
        subject: "Final notice: invoice {reference}",
        body:
          "Hi {customerName},\n\nThis is a final notice regarding invoice {reference}. The outstanding balance of {amount} is now {daysOverdue} days overdue.\n\nIf we do not receive payment, or hear from you, within 7 days, we will pause any further work and hand the account over for collection.\n\nIf there is a problem with the invoice, please reply to this email and we will resolve it.\n\n{paymentDetails}\n\nRegards,\n{businessName}",
      },
    },
  },
};
