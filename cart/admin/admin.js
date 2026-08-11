(() => {
  "use strict";

  const search = document.getElementById("order-search");
  const status = document.getElementById("status-filter");
  const cards = Array.from(document.querySelectorAll("[data-order-card]"));
  const summary = document.getElementById("filter-summary");
  const empty = document.getElementById("empty-filter");
  if (!search || !status || !summary || !empty) return;

  function filterOrders() {
    const query = search.value.trim().toLocaleLowerCase("id-ID");
    const selectedStatus = status.value;
    let visible = 0;
    cards.forEach((card) => {
      const matchesQuery = !query || card.dataset.search.includes(query);
      const matchesStatus = selectedStatus === "all" || card.dataset.status === selectedStatus;
      const show = matchesQuery && matchesStatus;
      card.hidden = !show;
      if (show) visible += 1;
    });
    summary.textContent = `${visible} pesanan ditampilkan`;
    empty.hidden = visible > 0 || cards.length === 0;
  }

  search.addEventListener("input", filterOrders);
  status.addEventListener("change", filterOrders);
})();
