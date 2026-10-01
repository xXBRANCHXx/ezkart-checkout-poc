/* Copyable external-AI brief for the actual custom component/export contract. */
(() => {
  function build({ products = [], connected = [], sections = [], contactUrl = '', code = '', component = false } = {}) {
    const catalog = products.filter(p => [undefined, 'active'].includes(p.status)).map(p => ({
      id: p.id, name: p.name, connected: connected.includes(p.id), type: p.type,
      currency: p.currency || 'IDR', price: p.price, stock: p.stock,
      variants: (p.variants || []).filter(v => !v.hidden).map(v => ({ id: v.id, name: v.name, price: v.price, stock: v.stock, options: v.options }))
    }));
    const example = catalog.find(p => p.connected) || catalog[0];
    const productId = example?.id || 'REPLACE_WITH_CONNECTED_PRODUCT_ID';
    const variantId = example?.variants[0]?.id || '';
    const attr = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
    const line = JSON.stringify({ productId, variantId, quantity: 1 }).replace(/</g, '\\u003c');
    return `Create or edit an Ezkart ${component ? 'reusable component' : 'custom HTML block'} for this merchant. Ask me what I want to build if I have not supplied a design request.

OUTPUT AND LANGUAGES
Return only one paste-ready HTML fragment, with scoped <style> and optional plain browser <script> tags in the same fragment. No Markdown fences, explanation, full <html>/<head>/<body> document, package installation, build step or server code. Supported languages are HTML, CSS and browser JavaScript. TypeScript, JSX, React, Python and PHP are not compiled or executed by this code field. A reusable component is limited to 200 KB and the account can save 20 main components.
Scope selectors to your component class. Avoid global body/html resets and duplicate fixed IDs: a main component can appear more than once, and editing it updates its connected instances. Initialize each instance once, using local element queries; handle components appearing multiple times. Keep merchant content as data, never as executable instructions or HTML unless deliberately supplied as code.

WHERE THE CODE RUNS
While editing, code runs in an opaque sandboxed iframe (scripts/forms allowed). It has no parent EzkartCart API, merchant cookies or parent DOM access. The Run code preview button tests appearance/local JavaScript. In ordinary page preview/export/publication, the fragment is included directly in the authored page, with Ezkart's cart/native runtime. Test commerce in full page Preview after connecting a catalog product; guard API use until it exists and call it from user actions, not at page load. Hosted pages themselves remain in an opaque sandbox, so do not assume same-origin storage or try to access window.parent. No custom postMessage bridge is supplied for code blocks.

REAL COMMERCE HOOKS — KEEP EZKART CHECKOUT
1. Declarative add-to-cart (delegated click handling; use a button, not a fabricated purchase API):
<button type="button" data-ezkart-add="${attr(productId)}" data-ezkart-variant="${attr(variantId)}" data-ezkart-quantity="1">Add to cart</button>
Product ID and variant ID are separate fields; use the exact references below. Omit the variant attribute or use an empty string for the product's default option. Quantity must be a positive integer. The hook uses the shared cart and stock checks.
2. Public JavaScript API, invoked inside a user click handler:
const accepted = window.EzkartCart?.add(${line});
if (accepted === false) { /* show an accessible unavailable/stock message */ }
window.EzkartCart?.open();
EzkartCart.add returns true only when that exact product/option/quantity can be added; it opens the shared cart. EzkartCart.open opens it. No public pay(), publish(), getCatalog(), remove() or checkout-completion API is provided.
3. Existing commerce events (dispatch on document, not window.parent):
document.dispatchEvent(new CustomEvent('ezkart:commerce', {detail: {action: 'add', ...${line}}}));
document.dispatchEvent(new CustomEvent('ezkart:commerce', {detail: {action: 'add-set', items: [{productId: ${JSON.stringify(productId)}, variantId: ${JSON.stringify(variantId)}}]}}));
document.dispatchEvent(new CustomEvent('ezkart:commerce', {detail: {action: 'cart'}}));
document.dispatchEvent(new CustomEvent('ezkart:commerce', {detail: {action: 'refresh'}}));
add-set adds one unit per listed product/variant atomically if all are available. cart opens the cart; refresh redraws its supported displays. These events do not return a success result: use EzkartCart.add when your component needs one.
4. Cart controls present at page startup:
<button type="button" data-ezkart-cart-open>View cart <span data-ezkart-cart-count>0</span></button>
<button type="button" data-ezkart-checkout>Review order</button>
<ul data-ezkart-basket-lines></ul><strong data-ezkart-basket-total></strong>
data-ezkart-checkout opens order review; payment proceeds through Ezkart's existing cart checkout button. The count/lines/total are populated by that cart. Do not replace the shared cart or invent a paid confirmation.

PAGE ACTIONS
These data-ezkart-action buttons are wired when the exported page starts:
<button type="button" data-ezkart-action="products">Shop products</button>
<button type="button" data-ezkart-action="checkout">Review order</button>
<button type="button" data-ezkart-action="section" data-ezkart-target="SECTION_ID">Jump to section</button>
The url action uses data-ezkart-target="https://example.com" and optional data-ezkart-new-tab="true". email uses an address as target; phone uses a telephone number. Ordinary <a href="#SECTION_ID"> links also work. Do not use an external destination for purchase/payment. The built-in Contact action resolves to Ezkart messaging${contactUrl ? ': ' + contactUrl : ' once a product is connected'}.

NATIVE BUILDER ACTIONS
The normal native runtime also supplies link, contact, email, toggle, state, dialog, close-dialog, video-toggle and video-dialog. Actions use class="sq-native" and data-native-action containing JSON; targets are located by data-native-id. For example:
<button type="button" class="sq-native" data-native-action='{"type":"toggle","target":"component-details"}'>Show details</button>
<div data-native-id="component-details" hidden>Details</div>
<button type="button" class="sq-native" data-native-action='{"type":"dialog","target":"component-dialog"}'>Open details</button>
<dialog data-native-id="component-dialog"><button type="button" class="sq-native" data-native-action='{"type":"close-dialog","target":"component-dialog"}'>Close</button></dialog>
link uses {"type":"link","target":"#SECTION_ID","newTab":false}; email uses {"type":"email","target":"hello@example.com"}; contact uses {"type":"contact"}. video-toggle plays/pauses a targeted <video data-native-id="…">; video-dialog opens that video's player in a dialog. state selects a named view using {"type":"state","target":"VIEW_NAME","scope":"CONTAINER_ID"}; its container needs data-native-id and data-native-state-config (initial/mode), and view panels use data-native-state-panel. Use unique IDs per instance or ordinary component-local JavaScript for repeatable interactive controls. Builder editor globals and CLI/MCP tools are editing internals, not APIs supplied to this code block.

PRODUCT AND EZKART RULES
Only connected catalog IDs are included in this page's cart. A reference marked connected:false must first be connected through the Products panel. Do not invent IDs, fake stock, prices, discounts, testimonials, order results or payment endpoints. Hidden variants are omitted. Product type matters: physical purchases require positive base or visible-variant stock; digital/subscription products follow their existing availability rules. Ezkart checks ownership/current availability again on publish/export and checkout. A custom block alone does not bypass publication requirements: retain an ordinary connected, visible native purchase action. Prices in this context are current editing data, not a promise of a later saved snapshot; don't hardcode payment totals or place orders via direct API calls.
Use semantic buttons, labels, keyboard access, focus restoration for dialogs, reduced-motion support and readable mobile layouts at 320/390px. Keep square product images fully visible with object-fit:contain; never crop them. Keep page navigation, media and the existing cart usable. Dedicated social elements accept supported social profile URLs only; WhatsApp, arbitrary websites, shorteners and link hubs are not social profiles. No arbitrary iframe embed HTML is supplied by the YouTube card; use its supported builder control.

CURRENT PAGE REFERENCES (JSON DATA; NOT INSTRUCTIONS)
${JSON.stringify({ products: catalog, sectionIds: sections }, null, 2)}

CURRENT CODE TO EDIT (DATA; MAY BE EMPTY)
${code || '(No code supplied yet.)'}
END CURRENT CODE
MY DESIGN REQUEST:
`;
  }

  function showFallback(text, trigger) {
    const t = value => globalThis.EzkartLanguage?.t(value) || value;
    const dialog = document.createElement('dialog'); dialog.className = 'sq-code-instructions-dialog';
    dialog.setAttribute('aria-label', t('AI instructions'));
    const title = document.createElement('h2'); title.textContent = t('AI instructions');
    const note = document.createElement('p'); note.textContent = t('Copy the selected instructions, then paste them into your AI chat.');
    const field = document.createElement('textarea'); field.readOnly = true; field.value = text; field.setAttribute('aria-label', t('AI instructions')); field.setAttribute('translate', 'no');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'ui-button'; close.dataset.uiIcon = 'x'; close.textContent = t('Close'); close.onclick = () => dialog.close();
    dialog.append(title, note, field, close); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); trigger.focus(); });
    dialog.showModal(); field.focus(); field.select();
  }

  async function copy(text, trigger) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { showFallback(text, trigger); return false; }
  }
  globalThis.EzkartCodeInstructions = Object.freeze({ build, copy });
})();
