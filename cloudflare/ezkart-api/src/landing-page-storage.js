// Read-only retries: a stalled object read must not occupy the entire PHP
// request window. Cancel late bodies before retrying to release R2 connections.
export async function readLandingPageJson(bucket, key, {timeoutMs = 6000, attempts = 2, onTiming} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    let expired = false, reader, timer;
    const read = (async () => {
      const object = await bucket.get(key);
      const opened = Date.now();
      if (expired) { await object?.body?.cancel().catch(() => {}); return; }
      if (!object) return null;
      reader = object.body.getReader();
      const decoder = new TextDecoder(), parts = [];
      for (;;) {
        const {done, value} = await reader.read();
        if (expired) return;
        if (done) break;
        parts.push(decoder.decode(value, {stream: true}));
      }
      parts.push(decoder.decode());
      const page = JSON.parse(parts.join(''));
      onTiming?.({attempt, openMs: opened - started, bodyMs: Date.now() - opened, bytes: object.size});
      return page;
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        void reader?.cancel().catch(() => {});
        reject(new Error('Landing page storage timed out'));
      }, timeoutMs);
    });
    try { return await Promise.race([read, timeout]); }
    catch (error) {
      expired = true;
      void reader?.cancel().catch(() => {});
      onTiming?.({attempt, elapsedMs: Date.now() - started, failed: true});
      if (error instanceof SyntaxError || attempt === attempts) throw error;
    } finally { clearTimeout(timer); }
  }
}
