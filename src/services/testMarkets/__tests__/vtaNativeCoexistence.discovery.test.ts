/**
 * Collect the actual optional PostgreSQL suite with Jest's real describe.skip.
 * Only the database boundary is replaced; local imports and registration run.
 * No subprocess, connection, SQL, or disposable database is needed here.
 */
describe('optional VTA PostgreSQL suite discovery', () => {
  const databaseAccesses: PropertyKey[] = [];
  const prismaConstruction = jest.fn(() => new Proxy({}, {
    get(_target, property) {
      databaseAccesses.push(property);
      throw new Error('Database access is forbidden during optional suite discovery');
    },
  }));
  const registeredHooks: string[] = [];
  const registeredTests: string[] = [];
  const executedCallbacks: string[] = [];
  const restores: Array<() => void> = [];
  const savedOptIn = process.env.VOLTEX_PG_TEST_URL;
  const savedDefault = process.env.DATABASE_URL;

  // A default URL must not opt the suite in or become a fallback connection.
  delete process.env.VOLTEX_PG_TEST_URL;
  process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/discovery_must_not_connect';
  jest.doMock('@prisma/client', () => ({
    ...jest.requireActual('@prisma/client'),
    PrismaClient: prismaConstruction,
  }));

  try {
    for (const hook of ['beforeAll', 'beforeEach', 'afterEach', 'afterAll'] as const) {
      const original = global[hook];
      const spy = jest.spyOn(global, hook).mockImplementation((callback, timeout) => {
        registeredHooks.push(hook);
        original(function (...args: unknown[]) {
          executedCallbacks.push(hook);
          return (callback as (...values: unknown[]) => unknown)(...args);
        }, timeout);
      });
      restores.push(() => spy.mockRestore());
    }
    const originalTest = global.test;
    const testSpy = jest.spyOn(global, 'test').mockImplementation(((name: string, callback: () => void | Promise<void>, timeout?: number) => {
      registeredTests.push(name);
      originalTest(name, async function () {
        executedCallbacks.push(name);
        await callback();
      }, timeout);
    }) as typeof global.test);
    restores.push(() => testSpy.mockRestore());

    // Run at registration time, not inside a test: Jest really collects the
    // nested skipped suite and its four test bodies without running any hook.
    jest.isolateModules(() => require('./vtaNativeCoexistence.pg.test'));
  } finally {
    for (const restore of restores.reverse()) restore();
    jest.dontMock('@prisma/client');
    if (savedOptIn === undefined) delete process.env.VOLTEX_PG_TEST_URL;
    else process.env.VOLTEX_PG_TEST_URL = savedOptIn;
    if (savedDefault === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDefault;
  }

  test('registers the real skipped suite without constructing Prisma or accessing the database', () => {
    expect(prismaConstruction).not.toHaveBeenCalled();
    expect(registeredTests).toHaveLength(4);
    expect(registeredHooks).toEqual(['beforeAll', 'beforeEach', 'afterAll']);
    expect(databaseAccesses).toEqual([]);
    expect(executedCallbacks).toEqual([]);
  });
});
