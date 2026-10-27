"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NRX_RETIRED_MESSAGE = void 0;
exports.isRetiredNrx = isRetiredNrx;
/** NRX is retired. Historical balances/audit rows stay intact; no new orders. */
function isRetiredNrx(value) {
    const normalized = value.trim().toUpperCase().replace(/[_-]/g, '/');
    return normalized.split('/').some(symbol => symbol.trim() === 'NRX')
        || ['NRXUSDT', 'NRXSIMUSDT'].includes(normalized.replace(/\s/g, ''));
}
exports.NRX_RETIRED_MESSAGE = 'NRX is no longer available for trading.';
//# sourceMappingURL=nrxRetirement.js.map