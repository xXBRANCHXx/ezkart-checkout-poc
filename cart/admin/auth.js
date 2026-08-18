(() => {
  "use strict";

  const button = document.getElementById("google-sign-in");
  const emailForm = document.getElementById("email-sign-in-form");
  const emailInput = document.getElementById("email-sign-in");
  const status = document.getElementById("auth-status");
  if (!button || !status) return;

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

  const completeLogin = async (accessToken, refreshToken) => {
    button.disabled = true;
    setStatus("Verifying your Google account…");
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
      throw new Error(result.error || "Ezkart could not verify this Google account.");
    }
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

  emailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput?.value.trim() || "";
    const submitButton = emailForm.querySelector("button[type='submit']");
    button.disabled = true;
    if (submitButton) submitButton.disabled = true;
    setStatus("Sending your secure sign-in link…");
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
      setStatus(`Check ${email} for your secure sign-in link.`);
    } catch (error) {
      button.disabled = false;
      if (submitButton) submitButton.disabled = false;
      setStatus(error instanceof Error ? error.message : "Email sign-in failed.", true);
    }
  });
})();
