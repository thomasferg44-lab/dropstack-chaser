// Everything client-specific lives here. Non-secret only — secrets go in .env.
// A new client deploy = swap this file, fresh Supabase project, new Netlify site.

export const companyConfig = {
  businessName: "Example Services",
  ownerName: "Owner",
  currency: "ZAR", // ISO 4217 code. Display formatting only — storage is integer cents.
  locale: "en-ZA", // used by Intl for number/date formatting

  // Bank details shown in nudge messages (leave blank to omit the line).
  paymentDetails: "",

  // Nudge templates. Placeholders: {customerName} {businessName} {amount}
  // {reference} {daysOverdue} {dueDate} {paymentDetails}
  // Used from Stage 6 onward; shipped now so the config shape is stable.
  nudgeTemplates: {
    whatsapp: {
      gentle:
        "Hi {customerName}, just a friendly reminder from {businessName} that invoice {reference} for {amount} was due on {dueDate}. It may have slipped through — no worries if so! {paymentDetails}",
      firm:
        "Hi {customerName}, invoice {reference} from {businessName} for {amount} is now {daysOverdue} days overdue (due {dueDate}). Could you let me know when we can expect payment? {paymentDetails}",
      final:
        "Hi {customerName}, this is a final reminder from {businessName} regarding invoice {reference} for {amount}, now {daysOverdue} days overdue. If payment isn't received within 7 days we'll have to pause further work and refer the account for collection. Please get in touch if there's a problem. {paymentDetails}",
    },
    email: {
      gentle: {
        subject: "Friendly reminder: invoice {reference} from {businessName}",
        body:
          "Hi {customerName},\n\nJust a friendly reminder that invoice {reference} for {amount} was due on {dueDate}. It may have slipped through — no problem if so.\n\n{paymentDetails}\n\nThanks,\n{businessName}",
      },
      firm: {
        subject: "Overdue: invoice {reference} ({daysOverdue} days)",
        body:
          "Hi {customerName},\n\nInvoice {reference} for {amount} is now {daysOverdue} days overdue (it was due on {dueDate}).\n\nCould you please confirm a date by which payment will be made?\n\n{paymentDetails}\n\nRegards,\n{businessName}",
      },
      final: {
        subject: "Final notice: invoice {reference}",
        body:
          "Hi {customerName},\n\nThis is a final notice regarding invoice {reference} for {amount}, now {daysOverdue} days overdue.\n\nIf payment is not received within 7 days, we will pause any further work and refer the account for collection. If there is a problem with the invoice, please reply to this email so we can resolve it.\n\n{paymentDetails}\n\nRegards,\n{businessName}",
      },
    },
  },
};
