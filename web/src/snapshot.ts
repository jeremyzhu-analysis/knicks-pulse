/**
 * What `knicks export` puts in a page so it needs no server: every document
 * of the API by path, and when the data was last checked. Null on the served
 * site.
 */
type Snapshot = { checkedAt: string | null; documents: Record<string, unknown> };

export const snapshot: Snapshot | null = (window as { __KNICKS__?: Snapshot }).__KNICKS__ ?? null;
