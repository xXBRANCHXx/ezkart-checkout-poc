import {commerceHash} from './commerce-orders.js';

const fail = (message, status = 422, code = '') => { throw new Response(message, {status, headers: code ? {'x-ezkart-error-code': code} : {}}); };
const number = (value, label, min = 0, max = 1000000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}`);
  return value;
};
const id = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,95}$/.test(value)) fail(`${label} is invalid`);
  return value;
};
const clean = (value, length) => {
  if (typeof value !== 'string' || value.length > length || /[\u0000-\u001f]/.test(value)) fail('Inventory text is invalid');
  return value.trim();
};
const edit = seller => { if (seller.role === 'viewer') fail('You do not have permission to change inventory', 403); };
const itemKey = item => item.productId + '~' + item.variantId;
const kinds = ['count', 'received', 'damaged', 'lost', 'correction', 'alert'];

export function inventoryInput(input, draft = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Inventory request must be an object');
  const kind = input.kind;
  if (!kinds.includes(kind)) fail('Choose an inventory action');
  const requestKey = clean(input.requestKey, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)) fail('Inventory request key is invalid');
  const noteValue = input.note ?? '';
  if (typeof noteValue !== 'string' || noteValue.length > 500) fail('Inventory note must be at most 500 characters');
  const note = noteValue.replaceAll('\r\n', '\n').trim();
  if (/[\u0000-\u0008\u000b-\u001f]/.test(note)) fail('Inventory note contains an invalid character');
  if (!draft && ['damaged', 'lost', 'correction'].includes(kind) && note.length < 3) fail('Explain this stock change in the note');
  if (!Array.isArray(input.items) || input.items.length > 100 || (!draft && !input.items.length)) fail('Choose between 1 and 100 inventory rows');
  if (input.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) fail('Inventory rows must be objects');
  const items = input.items.map(item => ({
    productId: id(item.productId, 'Product'), variantId: item.variantId ? id(item.variantId, 'Variant') : '',
    revision: number(item.revision, 'Product version', 1, Number.MAX_SAFE_INTEGER),
    quantity: number(item.quantity, kind === 'alert' ? 'Alert threshold' : 'Quantity', ['received', 'damaged', 'lost'].includes(kind) ? 1 : 0),
    ...(draft ? {label: clean(item.label ?? '', 300), beforeQuantity: number(item.beforeQuantity ?? 0, 'Previous quantity'), beforeAlert: number(item.beforeAlert ?? 15, 'Previous alert threshold')} : {}),
  })).sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  if (new Set(items.map(itemKey)).size !== items.length) fail('Each inventory row can be changed only once in a batch');
  for (const productId of new Set(items.map(item => item.productId))) {
    if (new Set(items.filter(item => item.productId === productId).map(item => item.revision)).size !== 1) fail('Refresh the selected variants so they use the same product version', 409, 'inventory_conflict');
  }
  return {requestKey, kind, note, items};
}

const inventorySql = `WITH stock AS (
  SELECT p.id AS product_id,'' AS variant_id,p.title,COALESCE(p.sku,'') AS sku,p.status,0 AS hidden,p.revision,p.stock_quantity AS on_hand
  FROM products p WHERE p.seller_id=? AND p.type='physical' AND p.status IN ('active','archived')
    AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
  UNION ALL
  SELECT p.id,v.id,p.title || ' — ' || v.name,v.sku,p.status,COALESCE(json_extract(v.options_json,'$.hidden'),0),p.revision,COALESCE(v.stock_quantity,0)
  FROM products p JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id
  WHERE p.seller_id=? AND p.type='physical' AND p.status IN ('active','archived')
), held AS (
  SELECT product_id,variant_id,SUM(quantity) AS reserved FROM inventory_reservations
  WHERE seller_id=? AND state='reserved' GROUP BY product_id,variant_id
), inventory AS (
  SELECT stock.*,COALESCE(held.reserved,0) AS reserved,on_hand-COALESCE(held.reserved,0) AS available,
    COALESCE(ip.reorder_point,15) AS reorder_point,stock.product_id || '~' || stock.variant_id AS row_key
  FROM stock LEFT JOIN held USING(product_id,variant_id)
  LEFT JOIN inventory_policies ip ON ip.seller_id=? AND ip.product_id=stock.product_id AND ip.variant_id=stock.variant_id
)`;

export async function inventoryOverview(env, seller, url) {
  const q = clean(url.searchParams.get('q') || '', 120);
  const status = url.searchParams.get('status') || 'active', level = url.searchParams.get('level') || 'all';
  if (!['active', 'archived', 'all'].includes(status) || !['all', 'low', 'zero'].includes(level)) fail('Inventory filter is invalid');
  const cursor = clean(url.searchParams.get('cursor') || '', 200);
  const limit = number(Number(url.searchParams.get('limit') || 50), 'Page size', 1, 100);
  const filter = "WHERE (?='all' OR status=?) AND instr(lower(title || ' ' || sku),lower(?))>0 AND (?='all' OR (?='low' AND available>0 AND available<=reorder_point) OR (?='zero' AND available<=0))";
  const binds = [seller.id, seller.id, seller.id, seller.id, status, status, q, level, level, level];
  const [rows, summary] = await env.DB.batch([
    env.DB.prepare(`${inventorySql} SELECT * FROM inventory ${filter} AND row_key>? ORDER BY row_key LIMIT ?`).bind(...binds, cursor, limit + 1),
    env.DB.prepare(`${inventorySql} SELECT COUNT(*) AS skuCount,COALESCE(SUM(on_hand),0) AS onHand,COALESCE(SUM(reserved),0) AS reserved,
      COALESCE(SUM(available),0) AS available,COALESCE(SUM(available<=0),0) AS outOfStock,COALESCE(SUM(available>0 AND available<=reorder_point),0) AS lowStock
      FROM inventory ${filter}`).bind(...binds),
  ]);
  const page = rows.results.slice(0, limit);
  return {sellerId: seller.id, canEdit: seller.role !== 'viewer', summary: summary.results[0],
    items: page.map(row => ({key: row.row_key, productId: row.product_id, variantId: row.variant_id, title: row.title,
      sku: row.sku, status: row.status, hidden: Boolean(row.hidden), revision: row.revision, onHand: row.on_hand,
      reserved: row.reserved, available: row.available, reorderPoint: row.reorder_point})),
    nextCursor: rows.results.length > limit ? page.at(-1).row_key : null};
}

export async function inventoryHistory(env, seller, url) {
  const cursor = number(Number(url.searchParams.get('cursor') || Number.MAX_SAFE_INTEGER), 'History cursor', 1, Number.MAX_SAFE_INTEGER);
  const limit = number(Number(url.searchParams.get('limit') || 30), 'Page size', 1, 100);
  const product = url.searchParams.get('product') || '', variant = url.searchParams.get('variant');
  if (product) id(product, 'Product'); if (variant) id(variant, 'Variant');
  const rows = await env.DB.prepare(`SELECT m.*,COALESCE(NULLIF(u.display_name,''),'Store member') AS actor_name
    FROM inventory_movements m LEFT JOIN app_users u ON u.auth_user_id=m.actor_auth_user_id
    WHERE m.seller_id=? AND m.id<? AND (?='' OR m.product_id=?) AND (? IS NULL OR m.variant_id=?) ORDER BY m.id DESC LIMIT ?`)
    .bind(seller.id, cursor, product, product, variant, variant, limit + 1).all();
  const page = rows.results.slice(0, limit);
  return {items: page.map(row => ({id: row.id, productId: row.product_id, variantId: row.variant_id, title: row.title, sku: row.sku,
    before: row.quantity_before, after: row.quantity_after, delta: row.quantity_after - row.quantity_before,
    reason: row.reason, reference: row.reference_id, actor: row.actor_auth_user_id ? row.actor_name : row.reason === 'payment' ? 'Payment service' : 'System',
    note: row.note, createdAt: row.created_at})), nextCursor: rows.results.length > limit ? page.at(-1).id : null};
}

export function movementStatement(env, {sellerId, productId, variantId = '', title, sku = '', before, after, reason, reference, actor = null, note = '', now}) {
  return env.DB.prepare(`INSERT INTO inventory_movements(seller_id,product_id,variant_id,title,sku,quantity_before,quantity_after,reason,reference_id,actor_auth_user_id,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sellerId, productId, variantId, title, sku, before, after, reason, reference, actor, note, now);
}

// Catalog changes have already asserted the original product revision in this
// batch. Track physical options, including hidden ones; never double-count the
// product's calculated total alongside its variants.
export function catalogStockMovements(env, context, beforeProduct, beforeVariants, afterProduct, afterVariants) {
  const rows = (product, variants) => !product || product.type !== 'physical' ? new Map() : new Map((variants.length ? variants.map(v => ({
    variantId: v.id, title: product.title + ' — ' + v.name, sku: v.sku, quantity: Number(v.stock_quantity || 0),
  })) : [{variantId: '', title: product.title, sku: product.sku || '', quantity: Number(product.stock_quantity || 0)}]).map(row => [row.variantId, row]));
  const before = rows(beforeProduct, beforeVariants), after = rows(afterProduct, afterVariants);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(key => {
    const old = before.get(key), next = after.get(key);
    if (old && next && old.quantity === next.quantity) return [];
    const row = next || old;
    return [movementStatement(env, {...context, productId: (afterProduct || beforeProduct).id, variantId: key,
      title: row.title, sku: row.sku, before: old?.quantity || 0, after: next?.quantity || 0,
      note: !next ? 'Removed from the physical catalog' : !old ? 'Added to the physical catalog' : ''})];
  });
}

export async function inventoryDraft(env, seller, authUserId, method, input) {
  if (method !== 'GET') edit(seller);
  if (method !== 'GET' && (!input || typeof input !== 'object' || Array.isArray(input))) fail('Inventory draft request must be an object');
  if (method === 'PUT') {
    const revision = number(input.revision, 'Draft version', 0, Number.MAX_SAFE_INTEGER);
    const payload = inventoryInput(input.payload, true), now = new Date().toISOString();
    const result = await env.DB.prepare(`INSERT INTO inventory_count_drafts(seller_id,auth_user_id,revision,payload_json,updated_at)
      SELECT ?,?,1,?,? WHERE ?=0 OR EXISTS (SELECT 1 FROM inventory_count_drafts WHERE seller_id=? AND auth_user_id=? AND revision=?)
      ON CONFLICT(seller_id,auth_user_id) DO UPDATE SET revision=inventory_count_drafts.revision+1,payload_json=excluded.payload_json,updated_at=excluded.updated_at
      WHERE inventory_count_drafts.revision=?`).bind(seller.id, authUserId, JSON.stringify(payload), now, revision, seller.id, authUserId, revision, revision).run();
    if (!result.meta.changes) {
      const current = await env.DB.prepare('SELECT * FROM inventory_count_drafts WHERE seller_id=? AND auth_user_id=?').bind(seller.id, authUserId).first();
      // A retry after losing the successful response must recover its receipt,
      // without treating another tab's different count as the same write.
      if (!current || current.revision !== revision + 1 || current.payload_json !== JSON.stringify(payload)) fail('This inventory draft changed in another tab or device. Reload it before editing.', 409, 'inventory_draft_conflict');
    }
  } else if (method === 'DELETE') {
    const revision = number(input.revision, 'Draft version', 1, Number.MAX_SAFE_INTEGER);
    // Keep the version counter after clearing so an old tab cannot overwrite a
    // new count that happens to start at revision 1 again (the ABA problem).
    const result = await env.DB.prepare("UPDATE inventory_count_drafts SET revision=revision+1,payload_json='null',updated_at=? WHERE seller_id=? AND auth_user_id=? AND revision=?")
      .bind(new Date().toISOString(), seller.id, authUserId, revision).run();
    if (!result.meta.changes) fail('This inventory draft changed. Reload it before discarding.', 409, 'inventory_draft_conflict');
  }
  const row = await env.DB.prepare('SELECT * FROM inventory_count_drafts WHERE seller_id=? AND auth_user_id=?').bind(seller.id, authUserId).first();
  return row ? {revision: row.revision, payload: JSON.parse(row.payload_json), updatedAt: row.updated_at} : null;
}

export async function adjustInventory(env, seller, authUserId, raw) {
  edit(seller);
  const input = inventoryInput(raw), requestHash = await commerceHash(input);
  const replay = async () => {
    const row = await env.DB.prepare('SELECT request_hash,receipt_json FROM inventory_adjustments WHERE seller_id=? AND request_key=?').bind(seller.id, input.requestKey).first();
    if (!row) return null;
    if (row.request_hash !== requestHash) fail('This adjustment key was already used for a different change', 409, 'inventory_replay_conflict');
    return JSON.parse(row.receipt_json);
  };
  const existing = await replay(); if (existing) return existing;
  const products = new Map();
  const currentRows = await env.DB.prepare(`${inventorySql} SELECT * FROM inventory WHERE row_key IN (SELECT value FROM json_each(?))`)
    .bind(seller.id, seller.id, seller.id, seller.id, JSON.stringify(input.items.map(itemKey))).all();
  const current = new Map(currentRows.results.map(row => [row.row_key, row]));
  const adjustmentId = 'adj_' + crypto.randomUUID().replaceAll('-', ''), now = new Date().toISOString();
  const lines = [];
  for (const item of input.items) {
    const selected = current.get(itemKey(item));
    if (!selected) fail('Physical inventory option not found', 404);
    products.set(item.productId, {revision: selected.revision, hasVariants: Boolean(selected.variant_id)});
    if (selected.revision !== item.revision) {
      const completed = await replay(); if (completed) return completed;
      fail('Stock or product details changed while this count was open. Review current quantities before saving.', 409, 'inventory_conflict');
    }
    const before = selected.on_hand;
    const after = input.kind === 'received' ? before + item.quantity : ['damaged', 'lost'].includes(input.kind) ? before - item.quantity : input.kind === 'alert' ? before : item.quantity;
    number(after, 'Resulting stock');
    lines.push({...item, title: selected.title, sku: selected.sku, before, after,
      alertBefore: selected.reorder_point, alertAfter: input.kind === 'alert' ? item.quantity : selected.reorder_point});
  }
  const receipt = {id: adjustmentId, kind: input.kind, note: input.note, createdAt: now, items: lines};
  const draftRevision = raw.draftRevision === undefined ? null : number(raw.draftRevision, 'Draft version', 1, Number.MAX_SAFE_INTEGER);
  const statements = [env.DB.prepare(`INSERT INTO inventory_adjustments(id,seller_id,request_key,request_hash,kind,note,actor_auth_user_id,draft_revision,receipt_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(adjustmentId, seller.id, input.requestKey, requestHash, input.kind, input.note, authUserId, draftRevision, JSON.stringify(receipt), now)];
  // Assert every product before any variant changes advance its root revision.
  for (const [productId, {revision}] of products) statements.push(env.DB.prepare(`INSERT INTO seller_events(id,seller_id,actor_auth_user_id,event_type,entity_type,entity_id,payload_json,created_at)
    VALUES (?,?,?,'inventory.adjusted','product',?,?,?)`).bind('event_' + crypto.randomUUID(), seller.id, authUserId, productId, JSON.stringify({expectedRevision: revision, adjustmentId}), now));
  for (const line of lines) {
    if (input.kind === 'alert') {
      statements.push(env.DB.prepare(`INSERT INTO inventory_policies(seller_id,product_id,variant_id,reorder_point,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(seller_id,product_id,variant_id) DO UPDATE SET reorder_point=excluded.reorder_point,updated_at=excluded.updated_at`)
        .bind(seller.id, line.productId, line.variantId, line.alertAfter, now));
    } else if (line.variantId) statements.push(env.DB.prepare('UPDATE product_variants SET stock_quantity=?,updated_at=? WHERE seller_id=? AND product_id=? AND id=?').bind(line.after, now, seller.id, line.productId, line.variantId));
    else statements.push(env.DB.prepare('UPDATE products SET stock_quantity=?,updated_at=? WHERE seller_id=? AND id=?').bind(line.after, now, seller.id, line.productId));
    statements.push(movementStatement(env, {sellerId: seller.id, productId: line.productId, variantId: line.variantId, title: line.title, sku: line.sku,
      before: line.before, after: line.after, reason: input.kind, reference: adjustmentId, actor: authUserId,
      note: (input.kind === 'alert' ? `Alert threshold: ${line.alertBefore} → ${line.alertAfter}. ` : '') + input.note, now}));
  }
  for (const [productId, {hasVariants}] of products) {
    if (hasVariants && input.kind !== 'alert') statements.push(env.DB.prepare(`UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants
      WHERE seller_id=? AND product_id=? AND COALESCE(json_extract(options_json,'$.hidden'),0)=0),updated_at=? WHERE seller_id=? AND id=?`).bind(seller.id, productId, now, seller.id, productId));
    else if (input.kind === 'alert') statements.push(env.DB.prepare('UPDATE products SET updated_at=? WHERE seller_id=? AND id=?').bind(now, seller.id, productId));
  }
  if (raw.draftRevision !== undefined) statements.push(env.DB.prepare("UPDATE inventory_count_drafts SET revision=revision+1,payload_json='null',updated_at=? WHERE seller_id=? AND auth_user_id=? AND revision=? AND json_extract(payload_json,'$.requestKey')=?")
    .bind(now, seller.id, authUserId, number(raw.draftRevision, 'Draft version', 1, Number.MAX_SAFE_INTEGER), input.requestKey));
  try { await env.DB.batch(statements); } catch (error) {
    const completed = await replay(); if (completed) return completed;
    const message = `${error?.message || ''} ${error?.cause?.message || ''}`;
    if (message.includes('inventory_draft_conflict')) fail('The saved count changed in another tab or device. Reload it before applying changes.', 409, 'inventory_draft_conflict');
    if (message.includes('catalog_revision_conflict')) fail('Stock changed while saving. Review current quantities before applying this count.', 409, 'inventory_conflict');
    if (message.includes('commerce_reserved_stock')) fail('Pending orders reserve more units than this change would leave. Review or resolve those orders before reducing stock.', 409, 'inventory_reserved');
    throw error;
  }
  return receipt;
}
