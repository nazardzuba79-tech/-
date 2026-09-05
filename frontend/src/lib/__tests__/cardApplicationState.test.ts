import {
  cardApplicationAction, createCardApplicationController,
  type CardApplicationClient, type CardApplicationSnapshot, type CardApplicationState,
} from '../../pages/crypto-card-final/cardApplicationState';

function snapshot(verificationApproved = true, depositEligible = true, tradingVolumeEligible = false): CardApplicationSnapshot {
  return { eligibility: {
    verificationApproved, depositEligible, tradingVolumeEligible,
    eligible: verificationApproved && (depositEligible || tradingVolumeEligible),
    qualifyingDepositUsd: depositEligible ? 5000 : 4999.99,
    qualifyingTradingVolumeUsd: tradingVolumeEligible ? 50000 : 49999.99,
    depositValuationComplete: true, tradingVolumeValuationComplete: true,
  }, application: null };
}

const saved: CardApplicationSnapshot = {
  ...snapshot(), application: { id: 'server-request-id', product: 'TITANIUM', status: 'SUBMITTED', submittedAt: '2026-09-05T12:00:00.000Z' },
};

function setup(data = snapshot(), reviewOnly = false) {
  const client: jest.Mocked<CardApplicationClient> = {
    getCardApplication: jest.fn().mockResolvedValue(data),
    submitCardApplication: jest.fn().mockResolvedValue(saved),
  };
  const states: CardApplicationState[] = [];
  const controller = createCardApplicationController(client, reviewOnly, state => states.push(state));
  return { client, states, controller, latest: () => states[states.length - 1] };
}

test.each([
  [false, false, false, 'verify'], [true, false, false, 'fund'],
  [true, true, false, 'apply'], [true, false, true, 'apply'],
  [true, true, true, 'apply'], [false, true, true, 'verify'],
] as const)('CTA for verification=%s deposit=%s volume=%s selects %s from the server result', (kyc, deposit, volume, expected) => {
  expect(cardApplicationAction(snapshot(kyc, deposit, volume))).toBe(expected);
});

test('frontend does not infer access from financial display values', () => {
  const data = snapshot(true, false, false);
  data.eligibility.qualifyingDepositUsd = 100000;
  data.eligibility.qualifyingTradingVolumeUsd = 1000000;
  expect(cardApplicationAction(data)).toBe('fund');
});

test('unknown asset valuations do not become a false insufficient-funds state', () => {
  const data = snapshot(true, false, false);
  data.eligibility.depositValuationComplete = false;
  expect(cardApplicationAction(data)).toBe('unavailable');
  const qualified = snapshot(true, false, true);
  qualified.eligibility.depositValuationComplete = false;
  expect(cardApplicationAction(qualified)).toBe('apply');
});

test('persisted application is displayed without issuing or fabricating anything', async () => {
  const { controller, client, latest } = setup(saved);
  await controller.load();
  expect(latest()).toEqual({ status: 'ready', data: saved, submitting: false });
  expect(cardApplicationAction(saved)).toBe('submitted');
  await controller.submit('BLACK_SIGNATURE');
  expect(client.submitCardApplication).not.toHaveBeenCalled();
});

test('isolated review never reads accounts, writes applications or fabricates eligibility', async () => {
  const { controller, client, states } = setup(snapshot(), true);
  await controller.load();
  await controller.submit('TITANIUM');
  expect(states).toEqual([]);
  expect(client.getCardApplication).not.toHaveBeenCalled();
  expect(client.submitCardApplication).not.toHaveBeenCalled();
});

test.each([[false, false, false], [false, true, true], [true, false, false]] as const)('ineligible state %s/%s/%s cannot submit', async (kyc, deposit, volume) => {
  const { controller, client } = setup(snapshot(kyc, deposit, volume));
  await controller.load();
  await controller.submit('TITANIUM');
  expect(client.submitCardApplication).not.toHaveBeenCalled();
});

test('cannot submit before account loading completes', async () => {
  const { controller, client } = setup();
  await controller.submit('TITANIUM');
  expect(client.submitCardApplication).not.toHaveBeenCalled();
});

test('submission uses server product/id/time and blocks duplicate clicks and refresh', async () => {
  const { controller, client, latest } = setup();
  let finish!: (data: CardApplicationSnapshot) => void;
  client.submitCardApplication.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await controller.load();
  const pending = controller.submit('BLACK_SIGNATURE');
  await controller.submit('TITANIUM');
  await controller.load();
  expect(client.submitCardApplication).toHaveBeenCalledTimes(1);
  expect(client.submitCardApplication).toHaveBeenCalledWith('BLACK_SIGNATURE');
  expect(client.getCardApplication).toHaveBeenCalledTimes(1);
  const result: CardApplicationSnapshot = { ...saved, application: { ...saved.application!, product: 'BLACK_SIGNATURE' } };
  finish(result);
  await pending;
  expect(latest()).toEqual({ status: 'ready', data: result, submitting: false });
});

test('read failure can be retried without false application success', async () => {
  const { controller, client, latest } = setup();
  const error = new Error('Unavailable');
  client.getCardApplication.mockRejectedValueOnce(error);
  await controller.load();
  expect(latest()).toEqual({ status: 'error', error });
  await controller.load();
  expect(latest()).toEqual({ status: 'ready', data: snapshot(), submitting: false });
});

test('rejected application refreshes revoked KYC instead of keeping an enabled stale CTA', async () => {
  const { controller, client, latest } = setup();
  await controller.load();
  const error = new Error('Verification changed');
  client.submitCardApplication.mockRejectedValueOnce(error);
  client.getCardApplication.mockResolvedValueOnce(snapshot(false, true, true));
  await controller.submit('TITANIUM');
  expect(latest()).toEqual({ status: 'ready', data: snapshot(false, true, true), submitting: false, error });
  await controller.submit('TITANIUM');
  expect(client.submitCardApplication).toHaveBeenCalledTimes(1);
});

test('rejected application plus unavailable refresh fails closed', async () => {
  const { controller, client, latest } = setup();
  await controller.load();
  const error = new Error('Network failed');
  client.submitCardApplication.mockRejectedValueOnce(error);
  client.getCardApplication.mockRejectedValueOnce(new Error('Read failed'));
  await controller.submit('TITANIUM');
  expect(latest()).toEqual({ status: 'error', error });
  await controller.submit('TITANIUM');
  expect(client.submitCardApplication).toHaveBeenCalledTimes(1);
});

test('retry after a transport failure recognizes a request already stored by the server', async () => {
  const { controller, client, latest } = setup();
  await controller.load();
  client.submitCardApplication.mockRejectedValueOnce(new Error('Response lost'));
  client.getCardApplication.mockResolvedValueOnce(saved);
  await controller.submit('TITANIUM');
  const result = latest();
  expect(result.status === 'ready' && result.data.application).toEqual(saved.application);
  expect(result).not.toHaveProperty('error');
  await controller.submit('TITANIUM');
  expect(client.submitCardApplication).toHaveBeenCalledTimes(1);
});

test('outdated reads cannot overwrite a newer server snapshot', async () => {
  const { controller, client, latest } = setup();
  let finish!: (data: CardApplicationSnapshot) => void;
  client.getCardApplication.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.load();
  await controller.load();
  finish(snapshot(false, false, false));
  await pending;
  expect(latest()).toEqual({ status: 'ready', data: snapshot(), submitting: false });
});

test('unmount ignores in-flight reads and prevents future API calls', async () => {
  const { controller, client, states } = setup();
  let finish!: (data: CardApplicationSnapshot) => void;
  client.getCardApplication.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.load();
  controller.dispose();
  finish(snapshot());
  await pending;
  await controller.load();
  await controller.submit('TITANIUM');
  expect(states).toEqual([{ status: 'loading' }]);
  expect(client.getCardApplication).toHaveBeenCalledTimes(1);
  expect(client.submitCardApplication).not.toHaveBeenCalled();
});
