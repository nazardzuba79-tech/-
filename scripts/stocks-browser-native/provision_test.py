"""Pure fixture validation; never calls provision, downloads, root tools or Chrome."""
import importlib.util
from contextlib import ExitStack
import io
import pathlib
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('native_provision', HERE / 'provision.py')
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)


class NativePureTests(unittest.TestCase):
    def test_public_gpg_witness_precedes_unchanged_signature_rejection(self):
        status = '[GNUPG:] KEYEXPIRED 123\n'
        listing = 'pub:e:fixture-public-key\n'
        stderr, stdout = io.StringIO(), io.StringIO()
        with mock.patch.object(P.sys, 'stderr', stderr), mock.patch.object(P.sys, 'stdout', stdout):
            with self.assertRaisesRegex(ValueError, '^GPG rejected signature$'):
                P.signing_proof_with_witness(status, listing, 123456789, 'a' * 40, '123-1')
        witness = P.json.loads(stderr.getvalue())
        self.assertEqual(stdout.getvalue(), '')
        self.assertTrue(witness['complete'])
        self.assertEqual(witness['streams']['status']['text'], status)
        self.assertEqual(witness['streams']['keyListing']['text'], listing)
        self.assertEqual(witness['sourceSha'], 'a' * 40)
        self.assertEqual(witness['runId'], '123-1')
        self.assertEqual(witness['observedAtUnixMs'], 123456789)
        self.assertEqual(witness['commandExitCodes'], {'listKeys': 0, 'decrypt': 0})
        self.assertEqual(witness['metadataSha256'], {
            'google-key.asc': P.M['key']['sha256'], 'InRelease': P.M['inRelease']['sha256'],
            'Packages.gz': P.M['packages']['sha256']})
        self.assertEqual(witness['googlePrimaryFingerprint'], P.M['googlePrimaryFingerprint'])

    def test_public_gpg_witness_success_is_stderr_only_complete_and_escaped(self):
        status = '[GNUPG:] PUBLIC_FIXTURE \x1b\x00\r\n"\\\u2603\n'
        listing = 'pub:fixture-public-key\n'
        stderr, stdout = io.StringIO(), io.StringIO()
        result = object()

        def verified(actual_status, actual_listing, now):
            witness = P.json.loads(stderr.getvalue())  # Must exist before parser invocation.
            self.assertEqual((actual_status, actual_listing, now), (status, listing, 123456789))
            for name, original in [('status', status), ('keyListing', listing)]:
                self.assertEqual(witness['streams'][name], {
                    'text': original, 'bytes': len(original.encode('utf-8')),
                    'sha256': P.digest(original.encode('utf-8'))})
            return result

        with mock.patch.object(P.sys, 'stderr', stderr), mock.patch.object(P.sys, 'stdout', stdout), \
                mock.patch.object(P, 'signing_proof', side_effect=verified) as parser:
            self.assertIs(P.signing_proof_with_witness(status, listing, 123456789, 'a' * 40, '123-1'), result)
        parser.assert_called_once()
        self.assertEqual(stdout.getvalue(), '')
        self.assertEqual(stderr.getvalue().count('\n'), 1)
        self.assertNotIn('\x1b', stderr.getvalue())
        self.assertNotIn('\x00', stderr.getvalue())
        self.assertLessEqual(len(stderr.getvalue().encode('ascii')), 128 * 1024)

    def test_public_gpg_witness_oversize_fails_with_hashes_and_no_truncation(self):
        # Escaping can expand raw bytes: the emitted JSON bound is authoritative.
        for status in ['x' * (128 * 1024), '\x00' * (24 * 1024)]:
            stderr = io.StringIO()
            with self.subTest(raw_bytes=len(status)), mock.patch.object(P.sys, 'stderr', stderr), \
                    mock.patch.object(P, 'signing_proof') as parser:
                with self.assertRaisesRegex(ValueError, 'exceeds 128 KiB; signature validation not run'):
                    P.signing_proof_with_witness(status, '', 123456789, 'a' * 40, '123-1')
            parser.assert_not_called()
            summary = P.json.loads(stderr.getvalue())
            self.assertFalse(summary['complete'])
            self.assertEqual(summary['failure'], 'PUBLIC_GPG_WITNESS_TOO_LARGE')
            self.assertGreater(summary['encodedBytes'], summary['maximumBytes'])
            self.assertEqual(summary['streams']['status'], {
                'bytes': len(status.encode('utf-8')), 'sha256': P.digest(status.encode('utf-8'))})
            self.assertNotIn('text', summary['streams']['keyListing'])
            self.assertLessEqual(len(stderr.getvalue().encode('ascii')), 128 * 1024)

    def metadata_blobs(self):
        return {'scripts/stocks-browser-native/metadata/' + name: (HERE / 'metadata' / name).read_bytes()
                for name in ['google-key.asc', 'InRelease', 'Packages.gz']}

    def test_original_metadata_exact_bytes_reject_tamper_truncation_swap_and_missing(self):
        blobs = self.metadata_blobs()
        self.assertEqual(set(P.pinned_metadata(blobs)), {'google-key.asc', 'InRelease', 'Packages.gz'})
        for name, raw in blobs.items():
            for invalid in [raw[:-1], bytes([raw[0] ^ 1]) + raw[1:], b'', None]:
                with self.assertRaisesRegex(ValueError, 'metadata (absent|pin mismatch)'):
                    P.pinned_metadata({**blobs, name: invalid})
        with self.assertRaises(ValueError):
            P.pinned_metadata({**blobs, 'scripts/stocks-browser-native/metadata/InRelease': blobs['scripts/stocks-browser-native/metadata/Packages.gz']})

    def test_only_fresh_key_is_fetched_and_must_equal_committed_original(self):
        snapshots = P.pinned_metadata(self.metadata_blobs())
        for changed_key in [False, True]:
            with tempfile.TemporaryDirectory() as temporary:
                directory = pathlib.Path(temporary)
                def fake_download(url, destination, maximum, expected_sha, expected_size):
                    self.assertEqual((url, maximum, expected_sha, expected_size),
                                     (P.M['key']['url'], P.M['key']['bytes'], P.M['key']['sha256'], P.M['key']['bytes']))
                    destination.write_bytes(b'changed official key' if changed_key else snapshots['google-key.asc'])
                with mock.patch.object(P, 'download', side_effect=fake_download) as network:
                    if changed_key:
                        with self.assertRaisesRegex(ValueError, 'fresh official key differs'):
                            P.stage_metadata(directory, snapshots)
                        self.assertFalse((directory / 'InRelease').exists())
                    else:
                        P.stage_metadata(directory, snapshots)
                        for name in ['InRelease', 'Packages.gz']:
                            self.assertEqual((directory / name).read_bytes(), snapshots[name])
                    network.assert_called_once()

    def test_original_signed_metadata_retains_identity_and_72_hour_freshness_limits(self):
        snapshots = P.pinned_metadata(self.metadata_blobs())
        text = snapshots['InRelease'].decode().replace('\r\n', '\n').split('\n\n', 1)[1].split('\n-----BEGIN PGP SIGNATURE-----', 1)[0]
        date = int(P.email.utils.parsedate_to_datetime(P.field(text, 'Date')).timestamp() * 1000)
        self.assertEqual(P.release_proof(text, snapshots['Packages.gz'], date + 3600000)['date'], date)
        for now in [date + P.M['metadataMaximumAgeMs'] + 1, date - P.M['metadataFutureToleranceMs'] - 1]:
            with self.assertRaisesRegex(ValueError, 'Release timestamp'):
                P.release_proof(text, snapshots['Packages.gz'], now)
        with self.assertRaisesRegex(ValueError, 'Release identity'):
            P.release_proof(text.replace('Origin: Google LLC', 'Origin: Untrusted'), snapshots['Packages.gz'], date + 3600000)

    def test_socket_bounds_include_all_agent_suffixes_and_terminating_nul(self):
        sizes = P.gpg_socket_bounds('/run/vsg-fixture/i')
        self.assertEqual(set(sizes), {'S.gpg-agent', 'S.gpg-agent.extra', 'S.gpg-agent.browser', 'S.gpg-agent.ssh'})
        for suffix, size in sizes.items():
            self.assertEqual(size, len(('/run/vsg-fixture/i/' + suffix).encode()) + 1)
        for name in ['gpg-import', 'gpg-trusted']:
            with self.assertRaisesRegex(ValueError, 'pathname bound'):
                P.gpg_socket_bounds(P.PREFIX.as_posix() + '/verification/' + name)
        longest_suffix = 'S.gpg-agent.browser'
        home = '/' + 'x' * (108 - len(longest_suffix) - 3)
        self.assertEqual(max(P.gpg_socket_bounds(home).values()), 108)
        for invalid in [home + 'x', '/' + 'é' * 60, '/run/../other', 'relative', '/run/bad\0value']:
            with self.assertRaises(ValueError):
                P.gpg_socket_bounds(invalid)

    def test_gpg_scratch_identity_rejects_path_owner_mode_inode_and_link_changes(self):
        expected = {'path': '/run/vsg-fixture', 'ino': 12, 'dev': 34}
        observed = {**expected, 'resolved': expected['path'], 'uid': 0, 'gid': 0, 'mode': 0o700, 'directory': True, 'symlink': False}
        P.validate_gpg_scratch(observed, expected)
        for changed in [{'resolved': '/run/elsewhere'}, {'uid': 1001}, {'gid': 1001}, {'mode': 0o755}, {'directory': False}, {'symlink': True}, {'ino': 13}, {'dev': 35}]:
            with self.assertRaises(ValueError):
                P.validate_gpg_scratch({**observed, **changed}, expected)
        with self.assertRaises(ValueError):
            P.validate_gpg_scratch({**observed, 'path': '/tmp/vsg-fixture'}, {**expected, 'path': '/tmp/vsg-fixture'})

    def scratch_mocks(self):
        observed = {'path': '/run/vsg-fixture', 'resolved': '/run/vsg-fixture', 'uid': 0, 'gid': 0, 'mode': 0o700, 'directory': True, 'symlink': False, 'ino': 12, 'dev': 34}
        stack = ExitStack()
        stack.enter_context(mock.patch.object(P, 'protected'))
        stack.enter_context(mock.patch.object(P.tempfile, 'mkdtemp', return_value='/run/vsg-fixture'))
        observation = stack.enter_context(mock.patch.object(P, 'gpg_scratch_observation', return_value=observed))
        stack.enter_context(mock.patch.object(P.pathlib.Path, 'mkdir'))
        stack.enter_context(mock.patch.object(P.pathlib.Path, 'lstat', return_value=SimpleNamespace(st_mode=P.stat.S_IFDIR | 0o700)))
        stack.enter_context(mock.patch.object(P.pathlib.Path, 'exists', return_value=False))
        removal = stack.enter_context(mock.patch.object(P.shutil, 'rmtree'))
        removal.avoids_symlink_attacks = True
        return stack, removal, observation

    def test_gpg_scratch_cleanup_on_success_import_failure_and_mock_term(self):
        for outcome in ['success', 'import-failure', 'term']:
            with self.subTest(outcome=outcome):
                stack, removal, _ = self.scratch_mocks()
                with stack, mock.patch.object(P.signal, 'getsignal', return_value='previous-handler'), mock.patch.object(P.signal, 'signal') as handlers:
                    proof = {'status': 'NOT_CREATED'}
                    def flow():
                        with P.provision_signals():
                            with P.temporary_gpg_homes(proof) as homes:
                                self.assertEqual([home.as_posix() for home in homes], ['/run/vsg-fixture/i', '/run/vsg-fixture/t'])
                                if outcome == 'import-failure':
                                    raise ValueError('mock GPG nonzero import')
                                if outcome == 'term':
                                    handlers.call_args_list[0].args[1](P.signal.SIGTERM, None)
                    if outcome == 'success':
                        flow()
                    else:
                        with self.assertRaisesRegex((ValueError, RuntimeError), 'mock GPG|interrupted by signal'):
                            flow()
                    removal.assert_called_once()
                    self.assertEqual(proof['status'], 'PASS')
                    self.assertLessEqual(proof['maximumSocketBytesIncludingNul'], 108)
                    self.assertEqual(handlers.call_args_list[-2].args, (P.signal.SIGTERM, 'previous-handler'))
                    self.assertEqual(handlers.call_args_list[-1].args, (P.signal.SIGINT, 'previous-handler'))

    def test_gpg_cleanup_failure_or_replaced_directory_never_claims_success(self):
        for tampered in [False, True]:
            stack, removal, observation = self.scratch_mocks()
            with stack:
                if tampered:
                    initial = observation.return_value
                    observation.side_effect = [initial, {**initial, 'ino': 99}]
                else:
                    removal.side_effect = OSError('mock cleanup failure')
                proof = {'status': 'NOT_CREATED'}
                with self.assertRaisesRegex(RuntimeError, 'cleanup FAIL'):
                    with P.temporary_gpg_homes(proof):
                        pass
                self.assertEqual(proof['status'], 'FAIL')
                if tampered:
                    removal.assert_not_called()

    def test_gpg_command_nonzero_is_still_a_hard_failure(self):
        with mock.patch.object(P.subprocess, 'run', return_value=SimpleNamespace(returncode=1)) as process:
            with self.assertRaisesRegex(ValueError, 'command failed'):
                P.command(['/usr/bin/gpg', '--no-autostart', '--import', 'fixture'])
            process.assert_called_once()

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
