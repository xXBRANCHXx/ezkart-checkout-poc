import {decodeHTML} from 'entities';
import {mountLandingMediaPlayer} from '../../../cart/landing-media-player.js';
import {mountMessageOrigin} from '../../../cart/message-origin.js';

// Only this host-owned shell has a normal origin. Authored code stays inside
// an opaque iframe, without access to merchant cookies, storage or the shell.
export const landingPageSandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';
export const landingPageShellPolicy = "default-src 'none'; img-src 'self' data: https:; media-src 'self' data: blob: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-src 'self' about: https:; frame-ancestors 'self'; base-uri 'none'";
export const landingPagePolicy = `${landingPageShellPolicy}; sandbox ${landingPageSandbox}`;

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));

export function landingPageFrame(html, {pageId,contactOrigin} = {}) {
  let source = String(html);
  const title = decodeHTML((source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Landing page').replace(/<[^>]*>/g, ''));
  const language = source.match(/<html\b[^>]*\blang="([a-z0-9-]+)"/i)?.[1] || 'en';
  let metadata = '';
  const description = source.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];
  if (description !== undefined) metadata += `<meta name="description" content="${escapeHTML(decodeHTML(description))}">`;
  // Copy only the builder's PNG icons. Authored head scripts never enter the shell.
  const icon = source.match(/<link\b[^>]*\bdata-ezkart-favicon\b[^>]*>/i)?.[0] || '';
  let light = icon.match(/\bdata-light="(data:image\/png;base64,[a-z0-9+/=]+)"/i)?.[1] || '';
  const dark = icon.match(/\bdata-dark="(data:image\/png;base64,[a-z0-9+/=]+)"/i)?.[1] || light;
  light ||= dark;
  for (const [mode, href] of [['light', light], ['dark', dark]]) {
    if (href) metadata += `<link rel="icon" type="image/png" sizes="128x128" media="(prefers-color-scheme: ${mode})" href="${escapeHTML(href)}">`;
  }
  // Library thumbnails pause motion; interactive views retain the saved runtime.
  source = source.replace(/<style\b[^>]*\bid=(?:"ezkart-library-preview-style"|'ezkart-library-preview-style')[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  // Older exports used location.href for checkout return links. srcdoc inherits
  // the durable public/preview URL through document.baseURI instead.
  source = source.replaceAll('return:location.href}', "return:(location.href==='about:srcdoc'?document.baseURI:location.href)}");
  const originScript = `<script>(${mountMessageOrigin.toString()})(document,${JSON.stringify({pageId,contactOrigin}).replace(/</g,'\\u003c')});</script>`;
  source = /<\/body>/i.test(source) ? source.replace(/<\/body>/i, originScript + '</body>') : source + originScript;
  return `<!doctype html><html lang="${escapeHTML(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title>${metadata}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe[data-hosted-page]{display:block;width:100%;height:100%;border:0}</style></head><body><iframe data-hosted-page allowfullscreen title="${escapeHTML(title)}" sandbox="${landingPageSandbox}" srcdoc="${escapeHTML(source)}"></iframe><script>(${mountLandingMediaPlayer.toString()})(document);</script></body></html>`;
}

export function hostedLandingResponse(html, {noindex = true,pageId,contactOrigin} = {}) {
  // R2 interactive previews arrive as streams. Keep the existing synchronous
  // response API while reading them before escaping into the authored iframe.
  const body = html === null ? null : typeof html === 'string' ? landingPageFrame(html,{pageId,contactOrigin}) : new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(new TextEncoder().encode(landingPageFrame(await new Response(html).text(),{pageId,contactOrigin})));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'content-security-policy': landingPageShellPolicy,
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    ...(noindex ? {'x-robots-tag': 'noindex, nofollow'} : {}),
  }});
}

export function landingPageLinks(page, seller) {
  const publicPath = `/${encodeURIComponent(seller.pageSlug || seller.slug)}/shop/${encodeURIComponent(page.id)}`;
  return {...page, publicPath, previewPath: `${publicPath}/preview`};
}
