(() => {
    "use strict";

    const money = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    });

    const jsonRequest = async (url, options = {}) => {
        const response = await fetch(url, {
            ...options,
            headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Request failed (${response.status})`);
        }
        return payload;
    };

    document.querySelectorAll(".copy-json").forEach((button) => {
        button.addEventListener("click", async () => {
            const code = button.closest(".json-block")?.querySelector("code")?.textContent || "";
            await navigator.clipboard.writeText(code);
            button.textContent = "Copied";
            window.setTimeout(() => { button.textContent = "Copy JSON"; }, 1300);
        });
    });

    document.getElementById("print-label")?.addEventListener("click", () => window.print());

    const sessionId = document.body.dataset.sessionId;
    const view = document.body.dataset.view;
    if (!sessionId) return;

    if (view === "return") {
        pollPaymentStatus(sessionId);
        return;
    }
    if (view !== "checkout") return;

    const form = document.getElementById("checkout-form");
    const alert = document.getElementById("checkout-alert");
    const areaSearch = document.getElementById("area-search");
    const areaResults = document.getElementById("area-results");
    const rateButton = document.getElementById("rate-button");
    const shippingFieldset = document.getElementById("shipping-fieldset");
    const shippingOptions = document.getElementById("shipping-options");
    const payButton = document.getElementById("pay-button");
    let checkout;
    let selectedQuote = "";
    let searchTimer;
    let searchCounter = 0;

    const showError = (error) => {
        alert.textContent = error instanceof Error ? error.message : String(error);
        alert.classList.remove("hidden");
        alert.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const clearError = () => alert.classList.add("hidden");
    const setBusy = (button, busy, text) => {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.disabled = busy;
        button.classList.toggle("button-loading", busy);
        button.textContent = busy ? text : button.dataset.label;
    };

    const renderSession = (data) => {
        checkout = data;
        const itemRoot = document.getElementById("summary-items");
        itemRoot.replaceChildren(...data.items.map((item) => {
            const row = document.createElement("div");
            row.className = "summary-item";
            const name = document.createElement("strong");
            name.textContent = item.name;
            const details = document.createElement("small");
            details.textContent = `${item.quantity} × ${money.format(item.unit_price)} · ${item.line_weight_grams} g`;
            const total = document.createElement("span");
            total.textContent = money.format(item.line_total);
            row.append(name, details, total);
            return row;
        }));
        document.getElementById("merchandise-total").textContent = money.format(data.merchandise_total);
        document.getElementById("payment-total").textContent = money.format(data.merchandise_total);
        document.getElementById("weight-total").textContent = `${data.total_weight_grams} g`;
        form.elements.name.value = data.customer.name || "";
        form.elements.email.value = data.customer.email || "";
        form.elements.phone.value = data.customer.phone || "";
        document.getElementById("summary-loading").classList.add("hidden");
        document.getElementById("summary-content").classList.remove("hidden");
        if (!["OPEN", "QUOTED", "PAYMENT_FAILED"].includes(data.status)) {
            window.location.assign(`/payment/return?session=${encodeURIComponent(sessionId)}`);
        }
    };

    jsonRequest(`/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}`)
        .then(renderSession)
        .catch(showError);

    areaSearch.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        form.elements.area_id.value = "";
        form.elements.area_name.value = "";
        form.elements.postal_code.value = "";
        areaResults.classList.remove("visible");
        selectedQuote = "";
        shippingFieldset.classList.add("hidden");
        payButton.classList.add("hidden");
        const query = areaSearch.value.trim();
        if (query.length < 3) return;
        const requestNumber = ++searchCounter;
        searchTimer = window.setTimeout(async () => {
            try {
                const data = await jsonRequest(`/api/v1/locations?q=${encodeURIComponent(query)}`);
                if (requestNumber !== searchCounter) return;
                areaResults.replaceChildren(...data.areas.map((area) => {
                    const option = document.createElement("button");
                    option.type = "button";
                    option.className = "area-option";
                    option.setAttribute("role", "option");
                    const name = document.createElement("strong");
                    name.textContent = area.name;
                    const detail = document.createElement("small");
                    detail.textContent = [area.city, area.province, area.postal_code].filter(Boolean).join(" · ");
                    option.append(name, detail);
                    option.addEventListener("click", () => {
                        areaSearch.value = area.name;
                        form.elements.area_id.value = area.id;
                        form.elements.area_name.value = area.name;
                        form.elements.postal_code.value = area.postal_code;
                        areaResults.classList.remove("visible");
                    });
                    return option;
                }));
                areaResults.classList.toggle("visible", data.areas.length > 0);
            } catch (error) {
                showError(error);
            }
        }, 450);
    });

    rateButton.addEventListener("click", async () => {
        clearError();
        if (!form.elements.area_id.value) {
            showError("Choose a location from the search results first.");
            return;
        }
        setBusy(rateButton, true, "Checking couriers…");
        try {
            const data = await jsonRequest("/api/v1/shipping/rates", {
                method: "POST",
                body: JSON.stringify({
                    session_id: sessionId,
                    destination_area_id: form.elements.area_id.value,
                    destination_area_name: form.elements.area_name.value,
                    destination_postal_code: form.elements.postal_code.value,
                }),
            });
            shippingOptions.replaceChildren(...data.rates.map((rate, index) => {
                const label = document.createElement("label");
                label.className = "shipping-option";
                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = "shipping";
                radio.value = rate.quote_token;
                const identity = document.createElement("span");
                const name = document.createElement("strong");
                name.textContent = `${rate.courier_name} · ${rate.courier_service_name}`;
                const duration = document.createElement("small");
                duration.textContent = rate.courier_duration || "Delivery estimate unavailable";
                identity.append(name, duration);
                const price = document.createElement("strong");
                price.className = "shipping-price";
                price.textContent = money.format(rate.shipping_price);
                radio.addEventListener("change", () => {
                    selectedQuote = rate.quote_token;
                    document.getElementById("shipping-total").textContent = money.format(rate.shipping_price);
                    document.getElementById("payment-total").textContent = money.format(rate.payment_total);
                    payButton.classList.remove("hidden");
                });
                label.append(radio, identity, price);
                if (index === 0) window.setTimeout(() => radio.click(), 0);
                return label;
            }));
            shippingFieldset.classList.remove("hidden");
            shippingFieldset.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (error) {
            showError(error);
        } finally {
            setBusy(rateButton, false, "");
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearError();
        if (!form.reportValidity() || !selectedQuote) {
            if (!selectedQuote) showError("Select a shipping service before payment.");
            return;
        }
        setBusy(payButton, true, "Creating secure invoice…");
        try {
            const payment = await jsonRequest("/api/v1/payments", {
                method: "POST",
                body: JSON.stringify({
                    session_id: sessionId,
                    quote_token: selectedQuote,
                    customer: {
                        name: form.elements.name.value,
                        email: form.elements.email.value,
                        phone: form.elements.phone.value,
                        address: form.elements.address.value,
                        note: form.elements.note.value,
                    },
                }),
            });
            window.location.assign(payment.payment_url);
        } catch (error) {
            showError(error);
            setBusy(payButton, false, "");
        }
    });

    async function pollPaymentStatus(id) {
        const shell = document.querySelector(".status-shell");
        const title = document.getElementById("status-title");
        const message = document.getElementById("status-message");
        const details = document.getElementById("status-details");
        const action = document.getElementById("status-action");
        let attempts = 0;
        const check = async () => {
            attempts += 1;
            try {
                const data = await jsonRequest(`/api/v1/checkout-sessions/${encodeURIComponent(id)}`);
                if (data.status === "PAID") {
                    shell.classList.add("success");
                    title.textContent = "Payment confirmed";
                    message.textContent = data.shipment.status === "NOT_CREATED"
                        ? "Your payment is secure. The shipment is being prepared."
                        : "Your payment and Biteship shipment are confirmed.";
                    details.replaceChildren(
                        detailRow("Order", data.merchant_order_reference),
                        detailRow("Total", money.format(data.payment_total)),
                        detailRow("Shipping", data.shipping.courier || "Preparing"),
                        detailRow("Waybill", data.shipment.waybill_id || "Generating"),
                    );
                    action.href = data.success_url;
                    action.textContent = "Return to ZERO";
                    action.classList.remove("hidden");
                    return;
                }
                if (data.status === "PAYMENT_FAILED") {
                    title.textContent = "Payment was not completed";
                    message.textContent = "No successful provider callback was received. Return to ZERO or try checkout again.";
                    action.href = data.cancel_url;
                    action.textContent = "Return to cart";
                    action.classList.remove("hidden");
                    return;
                }
                title.textContent = "Waiting for confirmation…";
                message.textContent = "Duitku has returned you to Ezkart. We are waiting for its signed server callback.";
            } catch (error) {
                message.textContent = error.message;
            }
            if (attempts < 30) window.setTimeout(check, 2000);
            else {
                title.textContent = "Payment still pending";
                message.textContent = "Confirmation is taking longer than expected. You can safely close this page and check your order later.";
            }
        };
        check();
    }

    function detailRow(label, value) {
        const row = document.createElement("div");
        const key = document.createElement("span");
        const content = document.createElement("strong");
        key.textContent = label;
        content.textContent = value;
        row.append(key, content);
        return row;
    }
})();
