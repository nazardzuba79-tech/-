import { useEffect } from 'react';

/** Sets the tab title and the description of an Academy/Help page while it
 * is shown, and puts back what was there when the visitor leaves. The build
 * writes the same values into a static copy of index.html for search engines
 * (see frontend/contentPlugin.ts); this keeps them right after in-app moves. */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousTitle = document.title;
    const previousDescription = meta?.getAttribute('content') ?? null;
    document.title = title;
    if (meta) meta.setAttribute('content', description);
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null) meta.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}
