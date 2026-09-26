import { EmailMessage } from 'cloudflare:email';
import { handle } from './core.js';

// Runtime wiring only; see core.js. The recipient is fixed twice: in core.js
// and by the `destination_address` restriction on the KYC_MAIL binding.
export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx, {
      now: () => Date.now(),
      fetch: (input, init) => fetch(input, init),
      cache: typeof caches !== 'undefined' ? caches.default : null,
      sendEmail: env.KYC_MAIL
        ? (from, to, raw) => env.KYC_MAIL.send(new EmailMessage(from, to, new Response(raw).body))
        : null,
    });
  },
};
