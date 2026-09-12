import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const digest = (file: string, text = false) => {
  const bytes = readFileSync(resolve(frontend, file));
  return createHash('sha256').update(text ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).digest('hex');
};

// Keep historical source artwork intact alongside the newly approved Titanium asset.
test('the previous travel artwork remains intact and the approved Titanium image is exact', () => {
  expect(digest('public/cards/travel/voltex-titanium-soft.png')).toBe('1baa20c61dc1a36844468c576b3f415fa60ee9814ade2c3148422783fb94da43');
  expect(digest('public/cards/travel/scene-A.png')).toBe('0d9acee58b04df5f5af2d65cc339d680a727287c39d795e926cad7216da706d4');
  expect(digest('public/cards/travel/center-mask.png')).toBe('985850585f266db712ae6dc1fd0a3b9cb432ae4cf78a7f00714b153511b92294');
});

test('assembly preserves the accepted Card text, CTAs, product framing and colored benefits', () => {
  expect(digest('src/pages/home/HomeCardTravel.tsx', true)).toBe('7c92fbbbaed39d8c608920e3b364fdf4c45a238a205f21728dce7bd1ef5b56c9');
  expect(digest('src/pages/home/home-card-travel.css', true)).toBe('bfea2f0a434c37d9e49acd3912e054c98b5dc9bff4c89bafe916bc151dfc128d');
});

test('the approved institutional scene and original logo artwork are restored without redesign', () => {
  const files: Record<string, string> = {
    'src/pages/home/HomeEcosystem.tsx': 'cea40d8a1386623da4eaa141d663188651f69523e1d307101de4e1ae8701f6ff',
    'src/pages/home/HomeInstitutionNetwork.tsx': '76bbdd0b47eef2a7641aebf0a9743517d399ea51736911fc75030e7be0d8c226',
    'src/pages/home/home-ecosystem.css': 'ccebfeaee645e7c811080da34b070cde2e785e773e25c882bdd3a7e477669435',
    'public/institutions/nasdaq.svg': '859c53a1aa08fcde9da6e4b36124737f486e28bcc091ce3a05fc93723189db74',
    'public/institutions/nyse.svg': 'c229107fc3abfda027450d6a00b8e0e037b03fcbf6f364c2b982115f60447f19',
    'public/institutions/cme.svg': '21188a75799d0e4d63b862ddc4c679640bc64050300c63859cc68ab52ad38fe3',
    'public/institutions/jpmorgan.svg': '071161dcb20a8fb37568127855346cfaddf94ebe32a6c7ddc93777887d7bc73e',
    'public/institutions/goldman.svg': '2f2195e8160285319f742ce8ff81a61269c02a63427da7c3905fe244dfaa8d07',
    'public/institutions/morganstanley.svg': 'c9ebd813e5bfd3ea4e3d2a68ae2c8c4ce881d0b8a3c1a4e3221cf6ff03c0affb',
  };
  for (const [file, expected] of Object.entries(files)) expect({ file, digest: digest(file, true) }).toEqual({ file, digest: expected });
});
