// Explicit preload for nested disposable CLI tests; never used by the app.
require('./isolated-prisma.cjs')(process.env.OTC_DIAGNOSTIC_CLIENT);
