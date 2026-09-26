/**
 * Where the support form posts: the voltex-support-edge Cloudflare Worker
 * (workers/support-edge). A public URL, not a secret — the recipient and the
 * mail binding live only in the Worker's server-side configuration.
 */
export const SUPPORT_ENDPOINT: string =
  import.meta.env.VITE_SUPPORT_ENDPOINT || 'https://support.voltextech.net/v1/support';
