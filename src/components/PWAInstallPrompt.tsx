"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isLikelyIos(): boolean {
  if (typeof window === "undefined") return false;

  const platform = window.navigator.platform || "";
  const userAgent = window.navigator.userAgent || "";

  return (
    /iPad|iPhone|iPod/.test(platform) ||
    (/Mac/.test(platform) && "ontouchend" in document) ||
    /iPhone|iPad|iPod/.test(userAgent)
  );
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-blocking. The manifest still allows add-to-home-screen on supported browsers.
      });
    }

    if (isStandaloneDisplay()) return;

    const dismissedUntil = Number(window.localStorage.getItem("wheelDesk.installDismissedUntil") || 0);
    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setHidden(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    const iosTimer = window.setTimeout(() => {
      if (isLikelyIos() && !isStandaloneDisplay()) {
        setShowIosHint(true);
        setHidden(false);
      }
    }, 1200);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.clearTimeout(iosTimer);
    };
  }, []);

  if (hidden || (!installEvent && !showIosHint)) return null;

  async function handleInstall() {
    if (installEvent) {
      await installEvent.prompt();
      await installEvent.userChoice.catch(() => null);
      setInstallEvent(null);
      setHidden(true);
      return;
    }

    setShowInstructions(true);
  }

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("wheelDesk.installDismissedUntil", String(Date.now() + 7 * 86_400_000));
    }
    setShowInstructions(false);
    setHidden(true);
  }

  return (
    <>
      <div className="wheeldesk-install-card" role="status" aria-live="polite">
        <div>
          <strong>Install WheelDesk</strong>
          <span>
            {showIosHint && !installEvent
              ? "On iPhone: tap Share, then Add to Home Screen."
              : "Add the Control Center to your phone home screen."}
          </span>
        </div>
        <button type="button" onClick={handleInstall}>
          {installEvent ? "Install" : "How"}
        </button>
        <button type="button" aria-label="Dismiss install prompt" onClick={dismiss} className="wheeldesk-install-close">
          ×
        </button>
      </div>

      {showInstructions ? (
        <div className="wheeldesk-install-modal-backdrop" role="presentation" onClick={() => setShowInstructions(false)}>
          <section
            className="wheeldesk-install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wheeldesk-install-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wheeldesk-install-modal-header">
              <div>
                <p className="wheeldesk-modal-eyebrow">iPhone install</p>
                <h2 id="wheeldesk-install-title">Add WheelDesk to your Home Screen</h2>
              </div>
              <button type="button" aria-label="Close install instructions" onClick={() => setShowInstructions(false)}>
                ×
              </button>
            </div>

            <ol className="wheeldesk-install-steps">
              <li>
                <strong>Open WheelDesk in Safari.</strong>
                <span>Apple only exposes Add to Home Screen properly from Safari.</span>
              </li>
              <li>
                <strong>Tap the Share icon.</strong>
                <span>It is the square with the upward arrow in the Safari toolbar.</span>
              </li>
              <li>
                <strong>Choose Add to Home Screen.</strong>
                <span>Name it WheelDesk, then tap Add.</span>
              </li>
            </ol>

            <div className="wheeldesk-install-modal-actions">
              <button type="button" onClick={() => setShowInstructions(false)}>Got it</button>
              <button type="button" onClick={dismiss}>Hide for 7 days</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
