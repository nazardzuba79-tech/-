/** Only an answered, successful account read can reclaim empty table space. */
export function isVerifiedEmptyAccountResource(resource: {
  data: readonly unknown[] | null;
  loaded: boolean;
  loading: boolean;
  failed: boolean;
}): boolean {
  return resource.loaded && !resource.loading && !resource.failed
    && Array.isArray(resource.data) && resource.data.length === 0;
}
