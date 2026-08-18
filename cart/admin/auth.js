(() => {
  "use strict";

  const button = document.getElementById("google-sign-in");
  const emailForm = document.getElementById("email-sign-in-form");
  const emailInput = document.getElementById("email-sign-in");
  const emailSentPanel = document.getElementById("email-sent-panel");
  const emailSentAddress = document.getElementById("email-sent-address");
  const emailResendButton = document.getElementById("email-resend-button");
  const emailChangeButton = document.getElementById("email-change-button");
  const emailSuccessPanel = document.getElementById("email-success-panel");
  const authDivider = document.querySelector(".auth-divider");
  const status = document.getElementById("auth-status");
  if (!button || !status) return;

  let lastEmail = "";
  let resendTimer = 0;
  const authenticationSignalKey = "ezkart.admin.authentication";
  const authenticationChannel = "BroadcastChannel" in window
    ? new BroadcastChannel(authenticationSignalKey)
    : null;

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };

  const cleanCallbackFragment = () => {
    const callback = new URLSearchParams(window.location.hash.slice(1));
    if (!window.location.hash) return callback;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return callback;
  };

  const showEmailVerificationSuccess = () => {
    if (!emailSentPanel || emailSentPanel.hidden || !emailSuccessPanel) return;
    window.clearInterval(resendTimer);
    emailSentPanel.hidden = true;
    emailForm.hidden = true;
    button.hidden = true;
    if (authDivider) authDivider.hidden = true;
    emailSuccessPanel.hidden = false;
    document.body.classList.add("verification-complete");
    setStatus("");
    document.title = "Verification successful · Ezkart";
  };

  const announceAuthentication = () => {
    const signal = { type: "authenticated", at: Date.now() };
    authenticationChannel?.postMessage(signal);
    try {
      window.localStorage.setItem(authenticationSignalKey, JSON.stringify(signal));
    } catch (_) {
      // BroadcastChannel is the primary path; storage can be unavailable in private browsing.
    }
  };

  authenticationChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "authenticated") showEmailVerificationSuccess();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== authenticationSignalKey || !event.newValue) return;
    try {
      if (JSON.parse(event.newValue)?.type === "authenticated") showEmailVerificationSuccess();
    } catch (_) {
      // Ignore malformed data written by unrelated scripts or browser extensions.
    }
  });

  const completeLogin = async (accessToken, refreshToken) => {
    button.disabled = true;
    setStatus("Verifying your account…");
    const body = new URLSearchParams({
      action: "supabase_login",
      csrf_token: button.dataset.csrfToken || "",
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    const response = await fetch(window.location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || "Ezkart could not verify this account.");
    }
    announceAuthentication();
    setStatus("Signed in. Opening your dashboard…");
    window.location.replace("./");
  };

  const callback = cleanCallbackFragment();
  const callbackError = callback.get("error_description") || callback.get("error");
  const accessToken = callback.get("access_token");
  const refreshToken = callback.get("refresh_token");
  if (callbackError) setStatus(callbackError, true);
  if (accessToken && refreshToken) {
    completeLogin(accessToken, refreshToken).catch((error) => {
      button.disabled = false;
      setStatus(error instanceof Error ? error.message : "Google sign-in failed.", true);
    });
  } else if (accessToken) {
    setStatus("Google sign-in did not return a persistent session. Please try again.", true);
  }

  button.addEventListener("click", () => {
    try {
      const supabaseUrl = new URL(button.dataset.supabaseUrl || "");
      const authorize = new URL("/auth/v1/authorize", supabaseUrl);
      authorize.searchParams.set("provider", "google");
      authorize.searchParams.set("redirect_to", `${window.location.origin}${window.location.pathname}`);
      button.disabled = true;
      setStatus("Opening Google…");
      window.location.assign(authorize.toString());
    } catch (_) {
      setStatus("The Supabase URL on this server is invalid.", true);
    }
  });

  const setEmailFormBusy = (busy) => {
    const submitButton = emailForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = busy;
    if (emailInput) emailInput.disabled = busy;
  };

  const startResendCountdown = () => {
    window.clearInterval(resendTimer);
    let remaining = 60;
    emailResendButton.disabled = true;
    emailResendButton.textContent = `Resend in ${remaining}s`;
    resendTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(resendTimer);
        emailResendButton.disabled = false;
        emailResendButton.textContent = "Resend verification email";
        return;
      }
      emailResendButton.textContent = `Resend in ${remaining}s`;
    }, 1000);
  };

  const sendEmailLogin = async (email, isResend = false) => {
    setEmailFormBusy(true);
    if (isResend) {
      emailResendButton.disabled = true;
      emailResendButton.textContent = "Sending…";
    } else {
      setStatus("Sending your secure sign-in link…");
    }
    try {
      const body = new URLSearchParams({
        action: "email_login",
        csrf_token: button.dataset.csrfToken || "",
        email,
      });
      const response = await fetch(window.location.pathname, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || "Ezkart could not send the sign-in email.");
      }
      lastEmail = email;
      emailForm.hidden = true;
      emailSentAddress.textContent = email;
      emailSentPanel.hidden = false;
      button.disabled = false;
      setStatus(isResend ? "A fresh verification email is on its way." : "");
      startResendCountdown();
    } catch (error) {
      button.disabled = false;
      setEmailFormBusy(false);
      if (isResend) {
        emailResendButton.disabled = false;
        emailResendButton.textContent = "Try resending again";
      }
      setStatus(error instanceof Error ? error.message : "Email sign-in failed.", true);
    }
  };

  emailForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput?.value.trim() || "";
    sendEmailLogin(email);
  });

  emailResendButton?.addEventListener("click", () => {
    if (lastEmail) sendEmailLogin(lastEmail, true);
  });

  emailChangeButton?.addEventListener("click", () => {
    window.clearInterval(resendTimer);
    emailSentPanel.hidden = true;
    emailForm.hidden = false;
    setEmailFormBusy(false);
    setStatus("");
    emailInput?.focus();
    emailInput?.select();
  });
})();
