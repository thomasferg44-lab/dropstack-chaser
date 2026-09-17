import { STATUS_LABELS } from "../lib/status.js";

const CLASSES = {
  unpaid: "text-status-due border-status-due/40",
  partial: "text-status-current border-status-current/40",
  paid: "text-status-paid border-status-paid/40",
  written_off: "text-dim border-border",
};

export default function StatusPill({ status }) {
  return (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border ${CLASSES[status] || CLASSES.unpaid}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
