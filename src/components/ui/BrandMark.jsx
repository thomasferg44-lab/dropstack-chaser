import { useState } from "react";
import { companyConfig } from "../../../companyConfig.js";
import { initials } from "../../lib/brand.js";

// The client's logo, or a clean initials monogram in the brand colour when
// there's no logo or it fails to load. Never a placeholder box.
export default function BrandMark({ size = 36, className = "" }) {
  const [failed, setFailed] = useState(false);
  const url = companyConfig.logoUrl;
  if (url && !failed) {
    return <img src={url} alt={`${companyConfig.businessName} logo`} width={size} height={size} onError={() => setFailed(true)}
      className={`object-contain ${className}`} style={{ height: size, width: "auto", maxWidth: size * 3.2 }} />;
  }
  return (
    <span aria-label={companyConfig.businessName} role="img"
      className={`inline-flex items-center justify-center rounded-[28%] bg-brand text-brand-ink font-semibold tracking-tight select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials(companyConfig.businessName)}
    </span>
  );
}
