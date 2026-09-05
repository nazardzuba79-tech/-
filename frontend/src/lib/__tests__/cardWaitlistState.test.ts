import { createCardWaitlistController, type CardWaitlistClient, type CardWaitlistSnapshot, type CardWaitlistState } from '../../pages/crypto-card-final/cardWaitlistState';

const approved: CardWaitlistSnapshot = { joined: false, joinedAt: null, kycStatus: 'APPROVED' };

function setup(data: CardWaitlistSnapshot = approved, reviewOnly = false) {
  const client: jest.Mocked<CardWaitlistClient> = {
    getCardWaitlist: jest.fn().mockResolvedValue(data),
    joinCardWaitlist: jest.fn().mockResolvedValue({ joined: true, joinedAt: '2026-09-05T12:00:00.000Z' }),
  };
  const states: CardWaitlistState[] = [];
  const controller = createCardWaitlistController(client, reviewOnly, state => states.push(state));
  return { client, states, controller, latest: () => states[states.length - 1] };
}

test('review-only never reads accounts, submits a join or fabricates account state', async () => {
  const { client, states, controller } = setup(approved, true);
  await controller.load();
  await controller.join();
  expect(client.getCardWaitlist).not.toHaveBeenCalled();
  expect(client.joinCardWaitlist).not.toHaveBeenCalled();
  expect(states).toEqual([]);
});

test('loads the existing server waitlist snapshot without changing its KYC or timestamp', async () => {
  const data = { ...approved, joined: true, joinedAt: '2026-08-29T11:23:00.000Z' };
  const { client, controller, states, latest } = setup(data);
  await controller.load();
  expect(client.getCardWaitlist).toHaveBeenCalledTimes(1);
  expect(states[0]).toEqual({ status: 'loading' });
  expect(latest()).toEqual({ status: 'ready', data, joining: false });
  await controller.join();
  expect(client.joinCardWaitlist).not.toHaveBeenCalled();
});

test.each(['NOT_STARTED', 'PENDING', 'REJECTED'] as const)('never submits a join for %s KYC', async kycStatus => {
  const { client, controller } = setup({ ...approved, kycStatus });
  await controller.load();
  await controller.join();
  expect(client.joinCardWaitlist).not.toHaveBeenCalled();
});

test('join cannot run before account loading completes', async () => {
  const { client, controller } = setup();
  await controller.join();
  expect(client.joinCardWaitlist).not.toHaveBeenCalled();
});

test('approved join uses the persisted response and blocks duplicate clicks', async () => {
  const { client, controller, latest } = setup();
  let resolveJoin!: (result: { joined: boolean; joinedAt: string }) => void;
  client.joinCardWaitlist.mockImplementation(() => new Promise(resolve => { resolveJoin = resolve; }));
  await controller.load();
  const joining = controller.join();
  expect(latest()).toEqual({ status: 'ready', data: approved, joining: true });
  await controller.join();
  await controller.load();
  expect(client.joinCardWaitlist).toHaveBeenCalledTimes(1);
  expect(client.getCardWaitlist).toHaveBeenCalledTimes(1);
  const joinedAt = '2026-09-04T09:17:36.000Z';
  resolveJoin({ joined: true, joinedAt });
  await joining;
  expect(latest()).toEqual({ status: 'ready', data: { ...approved, joined: true, joinedAt }, joining: false });
});

test('failed initial read exposes an error and can be retried', async () => {
  const { client, controller, latest } = setup();
  const error = new Error('Service unavailable');
  client.getCardWaitlist.mockRejectedValueOnce(error);
  await controller.load();
  expect(latest()).toEqual({ status: 'error', error });
  await controller.load();
  expect(latest()).toEqual({ status: 'ready', data: approved, joining: false });
});

test('failed join preserves genuine account data and allows a retry', async () => {
  const { client, controller, latest } = setup();
  const error = new Error('Request rejected');
  client.joinCardWaitlist.mockRejectedValueOnce(error);
  await controller.load();
  await controller.join();
  expect(latest()).toEqual({ status: 'ready', data: approved, joining: false, error });
  await controller.join();
  expect(client.joinCardWaitlist).toHaveBeenCalledTimes(2);
  expect(latest()).toEqual({ status: 'ready', data: { ...approved, joined: true, joinedAt: '2026-09-05T12:00:00.000Z' }, joining: false });
});

test('outdated reads cannot replace a later server snapshot', async () => {
  const { client, controller, latest } = setup();
  let resolveFirst!: (data: CardWaitlistSnapshot) => void;
  client.getCardWaitlist.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  const first = controller.load();
  await controller.load();
  resolveFirst({ ...approved, kycStatus: 'NOT_STARTED' });
  await first;
  expect(latest()).toEqual({ status: 'ready', data: approved, joining: false });
});

test('unmount ignores in-flight reads and prevents subsequent API calls', async () => {
  const { client, controller, states } = setup();
  let resolveRead!: (data: CardWaitlistSnapshot) => void;
  client.getCardWaitlist.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
  const pending = controller.load();
  controller.dispose();
  resolveRead(approved);
  await pending;
  await controller.load();
  await controller.join();
  expect(states).toEqual([{ status: 'loading' }]);
  expect(client.getCardWaitlist).toHaveBeenCalledTimes(1);
  expect(client.joinCardWaitlist).not.toHaveBeenCalled();
});
