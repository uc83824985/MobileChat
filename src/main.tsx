import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.tsx";

const applyServiceWorkerUpdate = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event("mobilechat:pwa-update-available"));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("mobilechat:pwa-offline-ready"));
  },
});

window.addEventListener("mobilechat:pwa-apply-update", () => {
  void applyServiceWorkerUpdate(true);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
