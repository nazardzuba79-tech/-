"""Pure fixture validation; never calls provision, downloads, root tools or Chrome."""
import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('native_provision', HERE / 'provision.py')
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)


class NativePureTests(unittest.TestCase):
    def test_signing_rejects_invalid_records(self):
        now = 1792058400000
        created = now // 1000 - 3600
        primary, signer = P.M['googlePrimaryFingerprint'], '0123456789ABCDEF0123456789ABCDEF01234567'
        status = f'[GNUPG:] VALIDSIG {signer} 2026-10-15 {created} 0 4 0 1 8 01 {primary}\n'
        listing = f'pub:-:4096:1:key:{created}:0:::::\nfpr:::::::::{primary}:\nsub:-:4096:1:sub:{created}:0:::::\nfpr:::::::::{signer}:\n'
        self.assertEqual(P.signing_proof(status, listing, now)['primary'], primary)
        for bad in ['BADSIG', 'ERRSIG', 'NO_PUBKEY', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED', 'FAILURE', 'ERROR', 'NODATA']:
            with self.assertRaises(ValueError):
                P.signing_proof(status + '[GNUPG:] ' + bad + ' bad\n', listing, now)
        with self.assertRaises(ValueError):
            P.signing_proof(status, listing.replace('sub:-:', 'sub:r:'), now)
        with self.assertRaises(ValueError):
            P.signing_proof(status, listing, now + P.M['metadataMaximumAgeMs'])

    def archive(self, path, members):
        with tarfile.open(path, 'w:gz') as archive:
            for name, kind in members:
                info = tarfile.TarInfo(name)
                info.mode = 0o4755
                if kind == 'link':
                    info.type, info.linkname = tarfile.SYMTYPE, '/etc/passwd'
                    archive.addfile(info)
                else:
                    info.size = 7
                    archive.addfile(info, io.BytesIO(b'fixture'))

    def test_npm_regular_files_only_and_new_suid_bits_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive = root / 'good.tgz'
            self.archive(archive, [('package/index.js', 'file')])
            P.extract_npm(archive, root / 'good')
            self.assertEqual((root / 'good/index.js').read_bytes(), b'fixture')
            self.assertEqual((root / 'good/index.js').stat().st_mode & 0o6000, 0)
            for i, members in enumerate([[('package/../escape', 'file')], [('package/link', 'link')], [('package/a', 'file'), ('package/a', 'file')], [('/absolute', 'file')]]):
                archive = root / f'bad{i}.tgz'
                self.archive(archive, members)
                with self.assertRaises(ValueError):
                    P.extract_npm(archive, root / f'bad{i}')

    def test_cleanup_prefix_is_fixed_not_manifest_selected(self):
        self.assertEqual(P.PREFIX.as_posix(), '/usr/lib/voltex-stocks-browser-' + P.DEB_SHA256)
        self.assertEqual(P.M['chrome']['sha256'], P.DEB_SHA256)
        self.assertTrue(P.owned_executable(str(P.PREFIX) + '/chrome/chrome'))
        self.assertTrue(P.owned_executable(str(P.PREFIX) + '/chrome/chrome (deleted)'))
        self.assertFalse(P.owned_executable('/opt/google/chrome/chrome'))
        self.assertFalse(P.owned_executable(str(P.PREFIX) + '-unrelated/chrome'))


if __name__ == '__main__':
    unittest.main()
