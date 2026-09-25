(() => {
  "use strict";
  const key = "ezkart.checkout.attempt.v1";
  window.EzkartCheckoutAttempt = {
    read() {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.version !== 1 || typeof value.body !== "string" || !/^[a-f0-9]{32}$/.test(JSON.parse(value.body)?.checkout_key || "")) {
        throw new Error("The saved payment attempt could not be read. Keep this tab open and contact the store before starting another payment.");
      }
      return value;
    },
    save(value) {
      const serialized = JSON.stringify({...value, version: 1});
      sessionStorage.setItem(key, serialized);
      if (sessionStorage.getItem(key) !== serialized) throw new Error("Unable to save payment recovery details in this tab.");
    },
    clear(orderId = "") {
      const saved = this.read();
      if (!saved || (orderId && saved.orderId !== orderId)) return;
      sessionStorage.removeItem(key);
    },
  };
})();
