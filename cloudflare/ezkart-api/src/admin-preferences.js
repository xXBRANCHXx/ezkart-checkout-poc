// Language belongs to the signed-in account, not to a landing page or store.
export async function adminPreferences(env, userId, payload = null) {
  if (payload !== null && !['en', 'id'].includes(payload.language))
    throw new Response('Choose English or Bahasa Indonesia.', {status: 422});
  const row = await env.DB.prepare('SELECT locale FROM app_users WHERE auth_user_id = ?').bind(userId).first();
  if (!row) throw new Response('Account not found.', {status: 404});
  if (payload !== null) {
    await env.DB.prepare('UPDATE app_users SET locale = ?, updated_at = ? WHERE auth_user_id = ?')
      .bind(payload.language === 'id' ? 'id-ID' : 'en', new Date().toISOString(), userId).run();
  }
  return {language: payload?.language || (/^id(?:-|$)/i.test(row.locale || '') ? 'id' : 'en')};
}
