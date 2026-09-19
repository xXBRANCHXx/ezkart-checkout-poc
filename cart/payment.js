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
  let pollTimer;
  let feedbackTimer;
  let failures = 0;
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
    const expiry = Date.parse(direct?.expires_at || "");
    const expired = Number.isFinite(expiry) && expiry <= Date.now();
    const state =
      data.status === "PAID"
        ? "PAID"
        : data.status === "FAILED"
          ? "FAILED"
          : expired
            ? "EXPIRED"
            : "PENDING";
    const available =
      direct?.method === "VIRTUAL_ACCOUNT_BCA" &&
      /^\d{8,30}$/.test(direct.account_number || "") &&
      Number.isFinite(expiry);
    shell.dataset.state = state;
    byId("payment-layout").hidden = false;
    byId("sandbox-badge").hidden = byId("sandbox-note").hidden =
      data.environment !== "sandbox";
    byId("payment-amount").textContent = byId("order-total").textContent =
      money(data.total);
    byId("order-subtotal").textContent = money(data.subtotal);
    byId("order-shipping").textContent = data.shipping_skipped
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
    byId("transfer-details").hidden = byId("payment-instructions").hidden =
      state !== "PENDING" || !available;
    byId("result-panel").hidden = state === "PENDING" && available;
    byId("check-payment").hidden = state === "PAID" || state === "FAILED";
    byId("order-link").hidden = state !== "PAID";
    byId("payment-state").textContent = {
      PAID: "Paid",
      EXPIRED: "Time expired",
      FAILED: "Not completed",
      PENDING: "Awaiting payment",
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
    if (state === "PAID") {
      byId("payment-title").textContent = "Payment confirmed";
      byId("payment-description").textContent =
        "Your payment has been confirmed. Thank you for your order.";
      byId("result-icon").textContent = "✓";
      byId("result-title").textContent = "Payment received";
      byId("result-message").textContent = data.shipping_skipped
        ? "Your test payment is complete. Delivery was skipped for this sandbox order."
        : "The seller will review your order and arrange delivery.";
      byId("check-message").textContent =
        "Confirmed securely by the payment service.";
      if (data.shop) {
        try {
          localStorage.removeItem("ezkart.checkout.cart.v1:" + data.shop);
        } catch (_) {}
      }
    } else if (state === "EXPIRED" || state === "FAILED") {
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
    } else if (!available) {
      byId("result-icon").textContent = "…";
      byId("result-title").textContent = "Payment details unavailable";
      byId("result-message").textContent =
        "We could not load a bank account for this order. Check again in a moment. Do not send a transfer without the account details.";
    }
  }
  async function check(manual = false) {
    if (requestInFlight || !orderId || payment?.status === "PAID") return;
    clearTimeout(pollTimer);
    requestInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    byId("check-payment").disabled = true;
    if (manual) byId("check-message").textContent = "Checking your payment…";
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
      if (manual && data.status !== "PAID")
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
      if (manual) feedback("Unable to check right now. Please try again.");
    } finally {
      clearTimeout(timeout);
      requestInFlight = false;
      byId("check-payment").disabled = false;
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
