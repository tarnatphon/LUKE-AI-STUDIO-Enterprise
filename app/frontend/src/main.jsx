import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app shell. Registered only in a built bundle — the Vite dev
// server serves modules from memory, which a service worker would cache as a
// stale shell and make every edit look like it did nothing.
if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A browser that refuses the worker still runs the app normally.
    });
  });
}
