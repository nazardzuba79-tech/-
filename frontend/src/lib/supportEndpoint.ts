import { API_BASE } from './api';
// Browser sends only to the authenticated API; relay credentials stay server-side.
export const SUPPORT_ENDPOINT = API_BASE + '/support/request';
