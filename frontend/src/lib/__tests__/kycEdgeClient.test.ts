/**
 * KYC edge client (frontend/src/lib/kycEdge.ts) and the guarantees around it:
 * the document goes to the Cloudflare KYC edge only — never to the VOLTEX API
 * on Render — and the user-facing form keeps its fields and button.
 *
 * `kycEdge.ts` reads `import.meta.env` at module scope, which CommonJS jest
 * cannot parse, so it is transpiled here the same way other suites do.
 * Synthetic bytes only.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import { RU } from '../i18n/locales/ru';

const frontend = resolve(__dirname, '../../..');
const EDGE = 'https://kyc.edge.test';

class FakeApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

function loadKycEdge(token: string | null = 'synthetic.jwt.token') {
  const output: Record<string, any> = {};
  const source = readFileSync(resolve(frontend, 'src/lib/kycEdge.ts'), 'utf8')
    .replace('import.meta.env.VITE_KYC_EDGE_URL', JSON.stringify(EDGE));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: Record<string, unknown> = { './api': { ApiError: FakeApiError, getToken: () => token } };
  new Function('require', 'exports', code)((name: string) => imports[name], output);
  return output;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    map,
  };
}

let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  (globalThis as any).localStorage = storage;
});
afterEach(() => { delete (globalThis as any).localStorage; });

const jpegFile = (bytes: number) => new File([new Uint8Array(bytes)], 'IMG_0001.jpg', { type: 'image/jpeg' });

describe('prepareKycDocument — client-side optimisation before upload', () => {
  it('re-encodes JPEG/PNG to JPEG (≤2400 px, q≈0.85) and reports the real size', async () => {
    const { prepareKycDocument } = loadKycEdge();
    const calls: [number, number][] = [];
    const encode = async (_f: File, edge: number, q: number) => { calls.push([edge, q]); return new Blob([new Uint8Array(700_000)], { type: 'image/jpeg' }); };
    for (const type of ['image/jpeg', 'image/png']) {
      const out = await prepareKycDocument(new File([new Uint8Array(6_000_000)], 'x', { type }), encode);
      expect(out.compressed).toBe(true);
      expect(out.file.type).toBe('image/jpeg');
      expect(out.file.size).toBe(700_000);
      expect(out.file.name).toBe('document.jpg'); // no user file name (it may carry a document number)
      expect(out.originalBytes).toBe(6_000_000);
    }
    expect(calls[0][0]).toBeGreaterThanOrEqual(2000);
    expect(calls[0][0]).toBeLessThanOrEqual(2500);
    expect(calls[0][1]).toBeGreaterThanOrEqual(0.82);
    expect(calls[0][1]).toBeLessThanOrEqual(0.88);
  });

  it('steps down once (2000 px, 0.82) when the first pass is still over 4 MB', async () => {
    const { prepareKycDocument } = loadKycEdge();
    const sizes = [5_000_000, 3_000_000];
    const seen: number[] = [];
    const out = await prepareKycDocument(jpegFile(9_000_000), async (_f: File, edge: number) => { seen.push(edge); return new Blob([new Uint8Array(sizes.shift()!)]); });
    expect(seen).toEqual([2400, 2000]);
    expect(out.file.size).toBe(3_000_000);
  });

  it('keeps a PDF as is under 4 MB and refuses a bigger one', async () => {
    const { prepareKycDocument, KycFileError } = loadKycEdge();
    const pdf = new File([new TextEncoder().encode('%PDF-1.4 synthetic')], 'scan.pdf', { type: 'application/pdf' });
    const out = await prepareKycDocument(pdf, async () => { throw new Error('must not re-encode a PDF'); });
    expect(out.file).toBe(pdf);
    await expect(prepareKycDocument(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }))).rejects.toBeInstanceOf(KycFileError);
  });

  it('refuses other types, and falls back to the original only when it fits', async () => {
    const { prepareKycDocument } = loadKycEdge();
    await expect(prepareKycDocument(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))).rejects.toMatchObject({ code: 'kyc_file_type' });
    const small = jpegFile(500_000);
    expect((await prepareKycDocument(small, async () => null)).file).toBe(small);
    await expect(prepareKycDocument(jpegFile(5_000_000), async () => null)).rejects.toMatchObject({ code: 'kyc_file_too_large' });
  });

  it('fitWithin never upscales and keeps the aspect ratio', () => {
    const { fitWithin } = loadKycEdge();
    expect(fitWithin(4000, 3000, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(1200, 1600, 2400)).toEqual({ width: 1200, height: 1600 });
  });
});

describe('submitKycToEdge — browser → Cloudflare, never Render', () => {
  it('posts multipart to the edge with the session token and no recipient/sender fields', async () => {
    const { submitKycToEdge } = loadKycEdge('synthetic.jwt.token');
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'PENDING', submissionId: 's-1', confirmed: true }), { status: 201 }));
    const result = await submitKycToEdge({ requestId: 'r-1', country: 'UA', fullName: 'Synthetic Person', dateOfBirth: '1990-01-01', documentType: 'PASSPORT', document: jpegFile(10) }, fetchImpl);
    expect(result.confirmed).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${EDGE}/v1/submit`);
    expect(url).not.toMatch(/api\.voltextech|\/api\/v1/);
    expect(init.headers).toEqual({ Authorization: 'Bearer synthetic.jwt.token' });
    expect(init.credentials).toBe('omit');
    const form = init.body as FormData;
    expect([...(form as any).keys()].sort()).toEqual(['country', 'dateOfBirth', 'document', 'documentType', 'fullName', 'requestId']);
    expect(storage.map.size).toBe(0);
  });

  it('delivered but not yet recorded → keeps only the sealed receipt, and the retry sends only that', async () => {
    const { submitKycToEdge, retryKycReceipt, readKycReceipt } = loadKycEdge();
    const receipt = 'A'.repeat(120);
    await submitKycToEdge({ requestId: 'r-2', country: 'UA', fullName: 'Synthetic Person', dateOfBirth: '1990-01-01', documentType: 'PASSPORT', document: jpegFile(10) },
      jest.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'PENDING', submissionId: 's-2', confirmed: false, receipt }), { status: 202 })));
    const stored = storage.getItem('voltex_kyc_receipt')!;
    expect(stored).not.toMatch(/Synthetic|1990/);
    expect(readKycReceipt()).toMatchObject({ submissionId: 's-2', receipt });

    const confirmFetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await retryKycReceipt(confirmFetch)).toBe(true);
    const [url, init] = confirmFetch.mock.calls[0];
    expect(url).toBe(`${EDGE}/v1/confirm`);
    expect(JSON.parse(init.body)).toEqual({ receipt });
    expect(readKycReceipt()).toBeNull();
  });

  it('a refusal surfaces as an ApiError carrying the edge code', async () => {
    const { submitKycToEdge } = loadKycEdge();
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'kyc_email_failed', code: 'kyc_email_failed' }), { status: 502 }));
    await expect(submitKycToEdge({ requestId: 'r-3', country: 'UA', fullName: 'Synthetic Person', dateOfBirth: '1990-01-01', documentType: 'PASSPORT', document: jpegFile(10) }, fetchImpl))
      .rejects.toMatchObject({ status: 502, body: { code: 'kyc_email_failed' } });
    expect(storage.map.size).toBe(0);
  });

  it('every edge/Render refusal code has customer wording that exists in the dictionary', () => {
    const { KYC_ERROR_KEYS } = loadKycEdge();
    for (const code of ['kyc_auth_required', 'kyc_already_verified', 'kyc_already_pending', 'kyc_file_type', 'kyc_file_mismatch', 'kyc_file_too_large', 'kyc_email_failed', 'kyc_rate_limited', 'kyc_service_unavailable']) {
      expect({ code, known: KYC_ERROR_KEYS[code] in RU }).toEqual({ code, known: true });
    }
  });
});

describe('no document bytes go to the VOLTEX API', () => {
  const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8');

  it('the frontend has no path that POSTs a file to /kyc/submit', () => {
    expect(read('src/lib/api.ts')).not.toMatch(/\/kyc\/submit/);
    expect(read('src/lib/api.ts')).not.toMatch(/submitKyc\s*:/);
    expect(read('src/pages/settings-arctic/VerificationSection.tsx')).toMatch(/submitKycToEdge\(/);
    expect(read('src/pages/settings-arctic/VerificationSection.tsx')).not.toMatch(/api\.submitKyc/);
  });

  it('the user form keeps its fields and the same submit button', () => {
    const form = read('src/pages/settings-arctic/VerificationSection.tsx');
    for (const needle of ['<CountrySelect', "t('settings.fullName')", "t('settings.dateOfBirth')", "t('settings.documentType')", 'type="file"', 'accept="image/jpeg,image/png,application/pdf"', "t('settings.sendForReview')"]) {
      expect({ needle, present: form.includes(needle) }).toEqual({ needle, present: true });
    }
  });

  it('the admin review does not request an emailed document from the server', () => {
    const review = read('src/pages/admin/KycSubmissionReview.tsx');
    expect(review).toMatch(/if \(emailed\) return;/);
    expect(review).toMatch(/Документ отправлен на email администратора/);
    expect(review).toMatch(/Проверено/);
    expect(review).toMatch(/Отклонить/);
  });
});
