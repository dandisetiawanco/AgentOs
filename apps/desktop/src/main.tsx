import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import { App } from "./App.js";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root container #root not found.");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
