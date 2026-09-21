const fail = (message, status = 422) => { throw new Response(message, { status }); };
const text = (value, maximum, name, minimum = 0) => {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) fail(`Enter a valid ${name}.`);
  return value.trim();
};
function cleanCoordinate(p) {
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || (!p.latitude && !p.longitude)) fail("The map position is invalid.");
  return { latitude: p.latitude, longitude: p.longitude };
}
function cleanAddress(input, id) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Enter an address.");
  const address = {
    id, label: text(input.label, 40, "address name", 1),
    address: text(input.address, 300, "street address", 5),
    location: text(input.location, 120, "district or city", 2),
    postalCode: text(input.postalCode, 5, "postcode", 5),
    fullName: text(input.fullName ?? "", 100, "recipient name"),
    phone: text(input.phone ?? "", 20, "phone number"),
    note: text(input.note ?? "", 120, "courier note"),
    coordinate: null,
  };
  if (!/^\d{5}$/.test(address.postalCode)) fail("Enter a five-digit postcode.");
  if (address.phone && !/^(?:\+62|62|0)8[1-9][0-9]{6,12}$/.test(address.phone.replace(/[\s-]/g, ""))) fail("Enter a valid Indonesian phone number.");
  if (input.coordinate != null) {
    address.coordinate = cleanCoordinate(input.coordinate);
  }
  return address;
}
export async function customerAddressBook(env, owner) {
  const row = await env.DB.prepare("SELECT addresses_json, default_address_id, revision FROM customer_address_books WHERE auth_user_id = ?").bind(owner).first();
  return row ? { addresses: JSON.parse(row.addresses_json), default_id: row.default_address_id, revision: row.revision, limit: 3 } : { addresses: [], default_id: "", revision: 0, limit: 3 };
}
export async function changeCustomerAddressBook(env, owner, input) {
  const current = await customerAddressBook(env, owner);
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) fail("Your saved addresses changed in another tab. Please review them and try again.", 409);
  const addresses = current.addresses;
  let defaultId = current.default_id;
  const index = addresses.findIndex(address => address.id === input.id);
  if (input.action === "save") {
    if (input.id && index < 0) fail("Address not found.", 404);
    if (index < 0 && addresses.length >= 3) fail("You can save up to three addresses. Edit or remove one to add another.", 409);
    const id = index < 0 ? crypto.randomUUID() : addresses[index].id;
    const address = cleanAddress(input.address, id);
    if (index >= 0) {
      const old = addresses[index];
      if (input.pin_confirmed !== true && ["address", "location", "postalCode"].some(key => old[key] !== address[key]) && JSON.stringify(old.coordinate) === JSON.stringify(address.coordinate)) address.coordinate = null;
      addresses[index] = address;
    } else addresses.push(address);
    if (!defaultId || input.make_default === true) defaultId = id;
  } else if (input.action === "pin") {
    if (index < 0) fail("Address not found.", 404);
    addresses[index] = { ...addresses[index], coordinate: cleanCoordinate(input.coordinate) };
  } else if (["delete", "default"].includes(input.action)) {
    if (index < 0) fail("Address not found.", 404);
    if (input.action === "default") defaultId = addresses[index].id;
    else { addresses.splice(index, 1); if (defaultId === input.id) defaultId = addresses[0]?.id || ""; }
  } else fail("Unknown address action.");
  const now = new Date().toISOString();
  const result = current.revision === 0
    ? await env.DB.prepare("INSERT OR IGNORE INTO customer_address_books (auth_user_id, addresses_json, default_address_id, revision, updated_at) VALUES (?, ?, ?, 1, ?)").bind(owner, JSON.stringify(addresses), defaultId, now).run()
    : await env.DB.prepare("UPDATE customer_address_books SET addresses_json = ?, default_address_id = ?, revision = revision + 1, updated_at = ? WHERE auth_user_id = ? AND revision = ?").bind(JSON.stringify(addresses), defaultId, now, owner, current.revision).run();
  if (result.meta.changes !== 1) fail("Your saved addresses changed in another tab. Please review them and try again.", 409);
  return { addresses, default_id: defaultId, revision: current.revision + 1, limit: 3 };
}
