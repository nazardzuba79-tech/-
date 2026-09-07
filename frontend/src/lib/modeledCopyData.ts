import { marketplaceTraders } from '../pages/copy-trading-bolt/traders';

// Capture the actual shipped fixture identities once. An API object with the
// same name/id or a spread copy is not evidence that its figures are modeled.
const catalogueFixtures = new WeakSet<object>(marketplaceTraders.filter(trader =>
  trader.id !== 'VX-001' && trader.id !== 'VX-KSENIA'));

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function explicitRealSource(value: Record<string, unknown>): boolean {
  return typeof value.provenance === 'string'
    && /^(REAL|LIVE)(?:_|$)/i.test(value.provenance);
}

/** Simulation REAL_TIME is an append clock, not evidence of real execution. */
export function isModeledResponse(value: unknown): boolean {
  const source = record(value);
  if (!source || explicitRealSource(source)) return false;
  if (typeof source.provenance === 'string'
    && ['SYNTHETIC_REVIEW', 'SYNTHETIC', 'MODELED', 'FIXTURE'].includes(source.provenance.toUpperCase())) return true;
  const simulation = record(source.simulation);
  return !!simulation && typeof simulation.seed === 'number' && Number.isFinite(simulation.seed)
    && typeof simulation.simulatedAt === 'string' && Number.isFinite(Date.parse(simulation.simulatedAt));
}

export function isModeledCatalogueTrader(value: unknown): boolean {
  const source = record(value);
  return !!source && !explicitRealSource(source) && catalogueFixtures.has(source);
}

export function isModeledTraderData(trader: unknown, response?: unknown): boolean {
  const identity = record(trader);
  if (!identity) return false;
  const payload = record(response);
  const payloadTrader = record(payload?.trader);
  // A matched authoritative response wins over any old fixture classification.
  // A payload from another strategy cannot label this strategy's figures.
  if (typeof identity.id === 'string' && payloadTrader?.id === identity.id) return isModeledResponse(payload);
  return isModeledResponse(identity) || isModeledCatalogueTrader(identity);
}

/** An aggregate containing fixture figures is itself partly modeled. */
export function isModeledAggregate(sources?: readonly unknown[]): boolean {
  return !!sources?.some(source => isModeledTraderData(source));
}

/** Retain provenance through the existing view projection without changing any
 * field, serialization, value, or source object. Not a name/id registry. */
export function preserveModeledSource<T extends object>(original: unknown, projection: T): T {
  const projected = record(projection);
  if (isModeledCatalogueTrader(original) && projected && !explicitRealSource(projected)) catalogueFixtures.add(projection);
  return projection;
}
