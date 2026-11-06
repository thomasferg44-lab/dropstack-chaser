import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyBrand } from "./lib/brand.js";
import { companyConfig } from "../companyConfig.js";
import "./index.css";

applyBrand(companyConfig);
document.title = companyConfig.businessName;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
