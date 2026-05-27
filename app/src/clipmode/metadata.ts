/**
 * Resolves the duration of a video Blob by mounting an offscreen
 * `<video>` element and reading `videoElement.duration`. Returns 0 when
 * the element fires `error`, when `URL.createObjectURL` throws, or when
 * the browser never reports a finite duration within the timeout — the
 * library treats 0 as "unknown" and the UI renders it as "—".
 *
 * Per `docs/QUALITY_GATES.md` §"Browser-API limitations (Phase 2b +
 * Phase 6)" §B5, real `<video>` semantics are MANUAL-only; this helper
 * lives outside the UI component so 6.2's tag screen and 6.3's runner
 * can reuse it.
 */
export async function extractDurationMs(
  file: Blob,
  timeoutMs = 5000,
): Promise<number> {
  return await new Promise<number>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(0)
      return
    }
    let url: string
    try {
      url = URL.createObjectURL(file)
    } catch {
      resolve(0)
      return
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
    }
    const timeout = window.setTimeout(() => {
      cleanup()
      resolve(0)
    }, timeoutMs)
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout)
      const ms = Number.isFinite(video.duration) ? video.duration * 1000 : 0
      cleanup()
      resolve(ms)
    }
    video.onerror = () => {
      window.clearTimeout(timeout)
      cleanup()
      resolve(0)
    }
  })
}
