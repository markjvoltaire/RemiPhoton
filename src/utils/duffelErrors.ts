import { DuffelError } from '@duffel/api';

/** Duffel often leaves `Error.message` empty; human text is on `errors[]`. */
export function formatDuffelError(err: unknown): string {
  if (err instanceof DuffelError && err.errors?.length) {
    return err.errors.map((e) => `${e.title}: ${e.message} (${e.code})`).join('; ');
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Best-effort: treat as stale offer so we can re-search with saved params. */
export function isStaleOfferError(err: unknown): boolean {
  if (!(err instanceof DuffelError) || !err.errors?.length) return false;
  return err.errors.some((e) => {
    const c = (e.code ?? '').toLowerCase();
    const t = `${e.title ?? ''} ${e.message ?? ''}`.toLowerCase();
    if (
      c.includes('expired') ||
      c.includes('no_longer') ||
      c.includes('invalid_offer') ||
      t.includes('expired') ||
      t.includes('no longer available')
    ) {
      return true;
    }
    return false;
  });
}
