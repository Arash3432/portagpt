export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PORTAL_IMAGE_WORKER_EAGER_START?.trim().toLowerCase() !== "true") return;
  try {
    const { ensureImageWorker } = await import("./lib/image-queue");
    ensureImageWorker();
  } catch (error) {
    // Keep the web server available when an optional background dependency
    // is not ready yet. Image requests retry worker initialization lazily.
    const message = error instanceof Error ? error.message : "unknown startup error";
    console.warn(`[portal-ai] image worker deferred: ${message}`);
  }
}
