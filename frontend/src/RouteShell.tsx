/**
 * What a route paints while its code chunk is still downloading.
 *
 * Deliberately NOT a spinner and NOT empty markup. The pages this stands in
 * for all render on the app's own dark surface, so the honest hold is that
 * surface at full viewport height: the background never flashes, the
 * scrollbar does not appear and disappear, and nothing shifts when the real
 * page arrives — it simply paints over a ground of exactly the same colour.
 *
 * A skeleton with fake rows was considered and rejected: every page here
 * has a different layout, so one generic skeleton would introduce the
 * layout jump it was supposed to prevent, and skeleton rows shaped like
 * data are a placeholder for data we do not have.
 *
 * `aria-busy` rather than a visible label, because this is a sub-second
 * transport hold, not a loading state the user has to read.
 */
export function RouteShell() {
  return (
    <div
      aria-busy="true"
      style={{ minHeight: '100vh', width: '100%', background: 'var(--bg)' }}
    />
  );
}
