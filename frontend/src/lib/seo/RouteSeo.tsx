import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyRouteSeo } from './head';

/** Keeps canonical and robots right after in-app moves (search engines that
 * run scripts see the rendered head). */
export function RouteSeo() {
  const { pathname } = useLocation();
  useLayoutEffect(() => applyRouteSeo(document, pathname), [pathname]);
  return null;
}
