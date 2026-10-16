/** Web Share API with a clipboard fallback (used on the "Done" screen). */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable';

export async function shareContent(data: {
  title: string;
  text: string;
  url?: string;
}): Promise<ShareOutcome> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return 'cancelled';
      // fall through to clipboard
    }
  }
  try {
    const payload = data.url ? `${data.text} ${data.url}` : data.text;
    await nav?.clipboard?.writeText(payload);
    return nav?.clipboard ? 'copied' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
