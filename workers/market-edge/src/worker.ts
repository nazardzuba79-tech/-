import existingWorker from './index.js';
import { nrxPublicResponse } from '../../../src/services/testMarkets/nrxPublic';

export default {
  async fetch(request: Request): Promise<Response> {
    return nrxPublicResponse(request) ?? existingWorker.fetch(request);
  },
};
