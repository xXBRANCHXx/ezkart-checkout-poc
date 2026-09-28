(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const shell = byId("payment");
  const orderId = shell.dataset.order;
  const money = (value) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(value);
  let payment = null;
  let requestInFlight = false;
  let manualCheck = false;
  let pollTimer;
  let feedbackTimer;
  let failures = 0;
  let sdkPromise;
  let modal;
  let modalObserver;
  let hostedOpening = false;
  function hostedPaymentUrl(data, flow) {
    if (data?.payment_flow !== flow || data.status !== "PENDING") return "";
    const expiry = Date.parse(data.payment_expires_at || "");
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return "";
    try {
      const url = new URL(data.payment_url);
      const hosts = data.environment === "production" ? ["jokul.doku.com"]
        : data.environment === "sandbox" ? ["sandbox.doku.com", "staging.doku.com"] : [];
      if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash && !url.search
          && /^\/(?:checkout-link(?:-v2)?\/|checkout\/link\/)[A-Za-z0-9_-]+$/.test(url.pathname)) return url.href;
    } catch (_) {}
    return "";
  }
  function loadHostedSdk(environment) {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = (environment === "production" ? "https://jokul.doku.com" : "https://sandbox.doku.com") + "/jokul-checkout-js/v1/jokul-checkout-1.0.0.js";
      script.referrerPolicy = "no-referrer";
      const timeout = setTimeout(() => fail(), 12000);
      const fail = () => { clearTimeout(timeout); script.remove(); sdkPromise = null; reject(new Error("sdk_unavailable")); };
      script.onerror = fail;
      script.onload = () => { clearTimeout(timeout); typeof window.loadJokulCheckout === "function" ? resolve() : fail(); };
      document.head.append(script);
    });
    return sdkPromise;
  }
  function closeHostedPayment() {
    if (!modal || modal.hidden) return;
    modalObserver?.disconnect();
    modal.hidden = true;
    modal.style.display = "none";
    modal.querySelector("iframe")?.remove();
    document.body.classList.remove("hosted-payment-open");
    shell.inert = false;
    document.querySelector(".payment-header").inert = false;
    byId("open-hosted-payment").focus();
    byId("hosted-payment-message").hidden = false;
    byId("hosted-payment-message").textContent = "The payment window is closed. We’re checking this order; you can reopen the same payment if needed.";
    check();
  }
  async function openHostedPayment() {
    if (hostedOpening || !hostedPaymentUrl(payment, "routed_hosted")) return;
    hostedOpening = true;
    const button = byId("open-hosted-payment"), message = byId("hosted-payment-message");
    button.disabled = true; button.setAttribute("aria-busy", "true");
    message.hidden = false; message.textContent = "Opening secure payment…";
    try {
      await loadHostedSdk(payment.environment);
      // Expiry or server confirmation may change while the SDK is loading.
      const url = hostedPaymentUrl(payment, "routed_hosted");
      if (!url) { render(); message.textContent = "Check this order’s latest payment status before continuing."; return; }
      modalObserver?.disconnect();
      document.getElementById("jokul_checkout_modal")?.remove();
      window.loadJokulCheckout(url);
      modal = document.getElementById("jokul_checkout_modal");
      const frame = modal?.querySelector("iframe");
      if (!frame) throw new Error("window_unavailable");
      modal.classList.add("ezkart-hosted-payment");
      modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Secure DOKU payment");
      frame.title = "Secure DOKU payment";
      frame.referrerPolicy = "no-referrer";
      const close = document.createElement("button");
      close.type = "button"; close.className = "hosted-payment-close";
      close.textContent = "Close payment window"; close.addEventListener("click", closeHostedPayment);
      modal.prepend(close);
      modal.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); closeHostedPayment(); }
        if (event.key === "Tab" && event.shiftKey && event.target === close) { event.preventDefault(); frame.focus(); }
      });
      modalObserver = new MutationObserver(() => {
        if (modal.style.display === "none") closeHostedPayment();
      });
      modalObserver.observe(modal, {attributes:true, attributeFilter:["style"]});
      shell.inert = true; document.querySelector(".payment-header").inert = true;
      document.body.classList.add("hosted-payment-open"); close.focus();
      message.textContent = "Complete payment in the secure window. This page will confirm your order when payment is received.";
    } catch (_) {
      message.textContent = "We couldn’t open the payment window. Try again to reopen the same payment; your order is saved.";
    } finally { hostedOpening = false; button.disabled = false; button.removeAttribute("aria-busy"); }
  }
  const notice = (text) => {
    byId("page-notice").textContent = text;
    byId("page-notice").hidden = !text;
  };
  const feedback = (text) => {
    clearTimeout(feedbackTimer);
    byId("copy-feedback").textContent = text;
    byId("copy-feedback").classList.add("visible");
    feedbackTimer = setTimeout(
      () => byId("copy-feedback").classList.remove("visible"),
      3000,
    );
  };
  function render() {
    if (!payment) return;
    const data = payment;
    const direct = data.payment_details;
    const expiry = Date.parse(direct?.expires_at || data.payment_expires_at || "");
    const expired = Number.isFinite(expiry) && expiry <= Date.now();
    const state =
      data.status === "PAID"
        ? "PAID"
        : ["FAILED", "CANCELLED", "EXPIRED"].includes(data.status)
          ? data.status
          : expired
            ? "EXPIRED"
            : data.status === "CREATING" ? "CREATING" : "PENDING";
    const available =
      direct?.method === "VIRTUAL_ACCOUNT_BCA" &&
      /^\d{8,30}$/.test(direct.account_number || "") &&
      Number.isFinite(expiry);
    let hostedUrl = "";
    if (data.payment_flow === "hosted" && state === "PENDING" && Number.isFinite(expiry) && !expired) {
      try {
        const url = new URL(data.payment_url), hosts = data.environment === "production" ? ["jokul.doku.com"] : ["sandbox.doku.com", "staging.doku.com"];
        if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash
            && /^\/(?:checkout-link(?:-v2)?\/|checkout\/link\/).+/.test(url.pathname)) hostedUrl = url.href;
      } catch (_) {}
    }
    const routedUrl = hostedPaymentUrl(data, "routed_hosted");
    if (modal && !modal.hidden && !routedUrl) closeHostedPayment();
    byId("open-hosted-payment").hidden = !routedUrl;
    if (state === "PAID") byId("hosted-payment-message").hidden = true;
    shell.dataset.state = state;
    byId("payment-layout").hidden = false;
    byId("sandbox-badge").hidden = byId("sandbox-note").hidden =
      data.environment !== "sandbox";
    byId("payment-amount").textContent = byId("order-total").textContent =
      money(data.total);
    byId("order-subtotal").textContent = money(data.subtotal);
    byId("order-shipping").textContent = data.shipping_kind === 'none' ? 'No shipping needed' : data.shipping_skipped
      ? "Skipped for test"
      : money(data.shipping_price);
    byId("order-number").textContent = data.order_id;
    byId("order-items").replaceChildren(
      ...data.items.map((item) => {
        const row = document.createElement("li");
        const label = document.createElement("span");
        label.className = "item-name";
        label.textContent = item.name;
        const quantity = document.createElement("small");
        quantity.textContent = `${item.quantity} × ${money(item.price)}`;
        label.append(quantity);
        const price = document.createElement("span");
        price.className = "item-price";
        price.textContent = money(item.quantity * item.price);
        row.append(label, price);
        return row;
      }),
    );
    const query = new URLSearchParams({ order: orderId });
    if (/^[a-z0-9][a-z0-9_-]{5,79}$/.test(data.shop || "")) {
      query.set("shop", data.shop);
      byId("checkout-link").href = "./?shop=" + encodeURIComponent(data.shop);
    }
    byId("order-link").href = "return.php?" + query.toString();
    byId("order-link").textContent = data.shipping_kind === 'none' ? 'View your downloads' : data.shipping_skipped ? "View order" : "Track your order";
    byId("transfer-details").hidden = byId("payment-instructions").hidden =
      state !== "PENDING" || !available;
    byId("result-panel").hidden = state === "PENDING" && available;
    byId("provider-payment-link").hidden = !hostedUrl;
    byId("provider-payment-link").href = hostedUrl || "#";
    byId("payment-bank-logo").hidden = !available;
    byId("payment-method-title").textContent = available ? "BCA Virtual Account" : "Secure payment";
    byId("payment-method-description").textContent = available ? "Bank transfer" : "Order payment";
    byId("check-payment").hidden = state === "PAID" || state === "FAILED";
    byId("order-link").hidden = state !== "PAID";
    byId("payment-state").textContent = {
      PAID: "Paid",
      EXPIRED: "Time expired",
      FAILED: "Not completed",
      PENDING: "Awaiting payment",
      CREATING: "Preparing payment",
      CANCELLED: "Cancelled",
    }[state];
    if (available) {
      byId("account-number").value = direct.account_number.replace(
        /(.{4})(?=.)/g,
        "$1 ",
      );
      // Display the actual bank recipient if provided; never substitute a brand for a bank-registered name.
      byId("account-name").hidden = !direct.account_name;
      byId("account-name").textContent = direct.account_name
        ? "Account name: " + direct.account_name
        : "";
      byId("payment-deadline").textContent =
        new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        }).format(expiry) + " WIB";
      byId("time-left").textContent = expired
        ? "Payment window has ended."
        : `${Math.max(1, Math.ceil((expiry - Date.now()) / 60000))} minutes remaining`;
    }
    if (["PAID", "EXPIRED", "FAILED", "CANCELLED"].includes(data.status)) {
      try { window.EzkartCheckoutAttempt.clear(orderId); } catch (_) {}
    }
    if (state === "PAID") {
      byId("payment-title").textContent = "Payment confirmed";
      byId("payment-description").textContent =
        "Your payment has been confirmed. Thank you for your order.";
      byId("result-icon").textContent = "✓";
      byId("result-title").textContent = "Payment received";
      byId("result-message").textContent = data.shipping_kind === 'none' ? 'Your payment is confirmed. Open your order to download your purchased files.' : data.shipping_skipped
        ? "Your test payment is complete. Delivery was skipped for this sandbox order."
        : "The seller will review your order and arrange delivery.";
      byId("check-message").textContent =
        "Confirmed securely by the payment service.";
      if (data.shop) {
        try {
          localStorage.removeItem("ezkart.checkout.cart.v1:" + data.shop);
        } catch (_) {}
      }
    } else if (["EXPIRED", "FAILED", "CANCELLED"].includes(state)) {
      byId("payment-title").textContent =
        state === "EXPIRED"
          ? "Payment window ended."
          : "Payment wasn’t completed.";
      byId("payment-description").textContent =
        "If you already paid, check the status before starting another order.";
      byId("result-icon").textContent = "◷";
      byId("result-title").textContent =
        state === "EXPIRED"
          ? "This account has expired"
          : "Payment unavailable";
      byId("result-message").textContent =
        "Do not transfer to this account. Return to checkout to try again, or keep your order number if you need help.";
      if (!manualCheck) byId("check-message").textContent = state === "EXPIRED"
        ? "If you already paid, we’ll keep checking for confirmation."
        : "Keep your order number if you need help.";
    } else if (state === "CREATING") {
      byId("payment-title").textContent = "Preparing your payment";
      byId("payment-description").textContent = "Your order is saved. We’re checking the payment service for your payment instructions.";
      byId("result-icon").textContent = "…";
      byId("result-title").textContent = "Payment setup is still being confirmed";
      byId("result-message").textContent = "Keep this order number. You can leave this page and return to the same payment; don’t start another order while this is being checked.";
      if (!manualCheck) byId("check-message").textContent = "We’ll keep checking this order automatically.";
    } else if (hostedUrl || routedUrl) {
      byId("payment-title").textContent = "Complete your payment";
      byId("payment-description").textContent = "Your secure payment session is ready.";
      byId("result-icon").textContent = "→";
      byId("result-title").textContent = "Continue to secure payment";
      byId("result-message").textContent = routedUrl ? "Choose a payment method in DOKU’s secure window. Your order and payment confirmation stay here." : "Choose your payment method and complete the payment on the secure payment page. Return here to check confirmation.";
      if (!manualCheck) byId("check-message").textContent = "Your order will update when payment is confirmed.";
    } else if (!available) {
      byId("result-icon").textContent = "…";
      byId("result-title").textContent = "Payment details unavailable";
      byId("result-message").textContent =
        "We could not load a bank account for this order. Check again in a moment. Do not send a transfer without the account details.";
    } else {
      byId("payment-title").textContent = "Complete payment";
      byId("payment-description").textContent = "Transfer to the BCA Virtual Account below to complete your order.";
      if (!manualCheck) byId("check-message").textContent = "Your payment will be confirmed automatically after the transfer.";
    }
  }
  async function check(manual = false) {
    if (!orderId || payment?.status === "PAID") return;
    if (manual) {
      manualCheck = true;
      byId("check-payment").disabled = true;
      byId("check-payment").setAttribute("aria-busy", "true");
      byId("check-message").textContent = "Checking your payment…";
    }
    // A click during a background request joins that request without starting another.
    if (requestInFlight) return;
    clearTimeout(pollTimer);
    requestInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        "api/status.php?order=" + encodeURIComponent(orderId),
        { cache: "no-store", signal: controller.signal },
      );
      const data = await response.json();
      if (
        !response.ok ||
        !data.ok ||
        data.order_id !== orderId ||
        !Number.isSafeInteger(data.total) ||
        !Array.isArray(data.items)
      )
        throw new Error("unavailable");
      payment = data;
      failures = 0;
      notice("");
      byId("retry-details").hidden = true;
      render();
      if (manualCheck && data.status !== "PAID")
        byId("check-message").textContent =
          "No payment confirmation yet. We’ll keep checking automatically.";
    } catch (_) {
      failures += 1;
      notice(
        payment
          ? "We couldn’t refresh the status. Your last payment details are shown below; we’ll try again."
          : "Payment details are temporarily unavailable. Please try checking again.",
      );
      if (!payment) byId("payment-layout").hidden = true;
      byId("retry-details").hidden = !!payment;
      if (manualCheck) {
        byId("check-message").textContent = "Unable to check right now. We’ll try again automatically.";
        feedback("Unable to check right now. Please try again.");
      }
    } finally {
      clearTimeout(timeout);
      requestInFlight = false;
      if (manualCheck) {
        byId("check-payment").disabled = false;
        byId("check-payment").removeAttribute("aria-busy");
        manualCheck = false;
      }
      if (
        payment?.status !== "PAID" &&
        payment?.status !== "FAILED" &&
        !document.hidden
      )
        pollTimer = setTimeout(check, Math.min(30000, 5000 * (failures + 1)));
    }
  }
  document.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (shell.dataset.state !== "PENDING" || !payment?.payment_details)
        return;
      const account = button.dataset.copy === "account";
      try {
        await navigator.clipboard.writeText(
          account
            ? payment.payment_details.account_number
            : String(payment.total),
        );
        feedback(account ? "Account number copied" : "Payment amount copied");
      } catch (_) {
        if (account) {
          byId("account-number").focus();
          byId("account-number").select();
        }
        feedback(
          account
            ? "Select and copy the account number."
            : "Copy the exact total shown above.",
        );
      }
    }),
  );
  byId("open-hosted-payment").addEventListener("click", openHostedPayment);
  byId("check-payment").addEventListener("click", () => check(true));
  byId("retry-details").addEventListener("click", () => check(true));
  document.addEventListener("visibilitychange", () => {
    clearTimeout(pollTimer);
    if (!document.hidden) check();
  });
  window.addEventListener("online", () => check());
  setInterval(() => {
    if (payment && !document.hidden && payment.status !== "PAID") render();
  }, 15000);
  if (!orderId)
    notice(
      "This payment link is invalid. Return to checkout to start your order.",
    );
  else check();
})();
