import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * WHERE THE SIGN-OUT LINK ACTUALLY SENDS YOU.
 *
 * `handleLogout` clears the token and navigates to `/`. For a long time it
 * did not get there. `App` holds no state of its own, so the JSX it returns
 * is built exactly once — at load. The root route's element was decided in
 * that JSX:
 *
 *     element={getToken() ? <Navigate to={defaultTradingPath()} /> : <HomePage />}
 *
 * A visitor who arrived signed in therefore froze `<Navigate to="/futures">`
 * into the route table for the lifetime of the tab. Pressing «Выйти» cleared
 * the token, routed to `/`, met that frozen redirect, went to the terminal,
 * and was bounced by the terminal's own guard to `/login?next=/futures`. The
 * home page was never rendered.
 *
 * It is not enough to fix `/` and move on: any route whose element decides on
 * the session while the table is being built has the same defect, and it is
 * invisible until someone signs out. So the rule is asserted for the whole
 * table — the session is read inside a component, where it is read again on
 * every render.
 */

const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
/** Comments talk about `getToken()`; only code counts. */
const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const routeElements = [...code.matchAll(/element=\{([\s\S]*?)\}\s*\/>/g)].map(match => match[1]);

describe('the route table decides nothing about the session up front', () => {
  it('has routes to check at all, so a passing run means something', () => {
    expect(routeElements.length).toBeGreaterThan(15);
  });

  it('never calls getToken() in an element prop', () => {
    const offenders = routeElements.filter(element => element.includes('getToken('));
    expect(offenders).toEqual([]);
  });

  it('gives "/" a component, so signing out lands on the home page', () => {
    expect(code).toMatch(/<Route path="\/" element=\{<RootEntry \/>\} \/>/);
    expect(code).toMatch(/function RootEntry\(\)[\s\S]*?getToken\(\)[\s\S]*?<HomePage \/>/);
  });
});
