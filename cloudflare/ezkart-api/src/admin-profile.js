// Admin identity is separate from shop appearance and every landing-page logo.
export async function adminProfile(env, seller, payload = null) {
  const row = await env.DB.prepare("SELECT settings_json FROM sellers WHERE id = ? AND status = 'active'").bind(seller.id).first();
  if (!row) throw new Response("Store not found", { status: 404 });
  let settings;
  try { settings = JSON.parse(row.settings_json || "{}"); } catch { settings = {}; }
  let logoId = settings.adminProfile?.logoId || "";
  const canEdit = seller.role !== "viewer";
  if (payload !== null) {
    if (!canEdit) throw new Response("You do not have permission to change the store logo", { status: 403 });
    if (typeof payload.logoId !== "string" || (payload.logoId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/.test(payload.logoId)))
      throw new Response("Choose a valid store logo", { status: 422 });
    if (payload.logoId && !await env.DB.prepare("SELECT id FROM media_uploads WHERE seller_id = ? AND id = ?").bind(seller.id, payload.logoId).first())
      throw new Response("The image does not belong to this store", { status: 422 });
    // Update only this field; concurrent shop or other settings edits stay intact.
    await env.DB.prepare("UPDATE sellers SET settings_json = json_set(settings_json, '$.adminProfile.logoId', ?), updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(payload.logoId, new Date().toISOString(), seller.id).run();
    logoId = payload.logoId;
  }
  return { logoId, canEdit };
}
