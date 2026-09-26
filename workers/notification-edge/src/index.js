import { WorkerEntrypoint } from 'cloudflare:workers';
import { handle, acceptEvent, Delivery, logFailure } from './core.js';

export default { fetch: handle };

// Only a configured service binding can invoke this entrypoint. Public HTTP
// cannot choose it or submit a KYC event, and it rejects deposit events.
export class KycNotifications extends WorkerEntrypoint {
  async notify(event) {
    try {
      const res = await acceptEvent(event, 'KYC_SUBMITTED', this.env);
      return { status: res.status, ...(await res.json()) };
    } catch {
      logFailure('UNAVAILABLE');
      return { status: 'UNAVAILABLE' };
    }
  }
}

export class NotificationEvent extends Delivery {}
