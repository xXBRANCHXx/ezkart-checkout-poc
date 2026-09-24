// Derived summaries never replace the saved project. An R2 version check makes
// concurrent saves, old cache writes and legacy projects safe to read.
export const landingSummaryKey = (sellerId, id) => `sellers/${sellerId}/landing-page-summaries/${id}.json`;

export async function listLandingObjects(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const result = await bucket.list({prefix, limit: 1000, include: ['customMetadata'], ...(cursor ? {cursor} : {})});
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function cacheLandingSummary(bucket, sellerId, object, summary) {
  await bucket.put(landingSummaryKey(sellerId, summary.id), JSON.stringify(summary), {
    httpMetadata: {contentType: 'application/json'},
    customMetadata: {sourceVersion: object.version},
  });
}

export async function readLandingSummary(bucket, sellerId, listed, summarize) {
  const id = listed.key.split('/').at(-1).replace(/\.json$/, '');
  const cached = await bucket.get(landingSummaryKey(sellerId, id));
  if (cached?.customMetadata?.sourceVersion === listed.version) {
    try { return await cached.json(); } catch (_) { /* Rebuild a damaged derived cache. */ }
  }
  const source = await bucket.get(listed.key);
  if (!source) return null; // It may have been deleted after listing.
  const summary = summarize(await source.json());
  await cacheLandingSummary(bucket, sellerId, source, summary).catch(() => {});
  return summary;
}

// The gallery is a static first-screen preview. Its sandbox already disables
// scripts; do not transfer their code or offscreen Image Stack artwork.
export function staticLandingPreview(response) {
  let imageTop = 0;
  return new HTMLRewriter()
    .on('script', {element(node) { node.remove(); }})
    .on('[data-image-page] > img', {element(node) {
      const width = Number(node.getAttribute('width'));
      const height = Number(node.getAttribute('height'));
      if (imageTop >= 1000) { node.remove(); return; }
      if (width > 0 && height > 0) imageTop += height * Math.min(480, width) / width;
    }})
    .transform(response);
}
