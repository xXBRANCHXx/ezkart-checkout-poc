// A lossless wire format: embedded images occur in native attributes, rendered
// HTML and catalog snapshots. Send each image once without changing saved data.
export function landingPageSaveReceipt(page) {
  // The caller already has its submitted state and artwork. Only return the
  // authoritative identity, publication status and save version after storage.
  const {id, name, url, status, products, createdAt, updatedAt, publishedAt, publicPath, previewPath} = page;
  return {id, name, url, status, products, createdAt, updatedAt, publishedAt, publicPath, previewPath};
}

export function packLandingEditor(page) {
  const {publishedHtml, ...editable} = page;
  const source = JSON.stringify(editable);
  const images = [], indexes = new Map(), parts = [];
  let offset = 0;
  for (const match of source.matchAll(/data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-zA-Z0-9+/=]{1024,}/g)) {
    parts.push(source.slice(offset, match.index));
    if (!indexes.has(match[0])) { indexes.set(match[0], images.length); images.push(match[0]); }
    parts.push(indexes.get(match[0]));
    offset = match.index + match[0].length;
  }
  parts.push(source.slice(offset));
  return {format: 'images-v1', parts, images};
}
