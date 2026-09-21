(() => {
  let openNew = new URLSearchParams(location.search).get("new") === "1";
  const book = window.ezkartAddressBook(document.getElementById("customer-address-book"), {
    onAccount: ({ authenticated }) => {
      if (authenticated && openNew) { openNew = false; book.save(); }
    },
  });
})();
