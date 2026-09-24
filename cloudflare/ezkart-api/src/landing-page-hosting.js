// Authored code runs in an opaque origin, without access to merchant cookies,
// storage or the admin document. Keep this policy in sync with cart/page.php
// and the authenticated /view proxy in cart/admin/index.php.
export const landingPagePolicy = "default-src 'none'; img-src 'self' data: https:; media-src 'self' data: blob: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-src 'self' about: https:; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

export function hostedLandingResponse(html, {noindex = true} = {}) {
  return new Response(html, {headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'content-security-policy': landingPagePolicy,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...(noindex ? {'x-robots-tag': 'noindex, nofollow'} : {}),
  }});
}

export function landingPageLinks(page, seller) {
  const publicPath = `/${encodeURIComponent(seller.pageSlug || seller.slug)}/shop/${encodeURIComponent(page.id)}`;
  return {...page, publicPath, previewPath: `${publicPath}/preview`};
}
