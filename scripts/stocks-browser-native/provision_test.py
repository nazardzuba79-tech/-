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
        status = '[GNUPG:] BADSIG public-fixture\n[GNUPG:] KEYEXPIRED 123\n'
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
        for bad in ['BADSIG', 'ERRSIG', 'NO_PUBKEY', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYREVOKED', 'KEYEXPIRED', 'SIGEXPIRED', 'FAILURE', 'ERROR', 'NODATA']:
            with self.assertRaises(ValueError):
                P.signing_proof(status + '[GNUPG:] ' + bad + ' bad\n', listing, now)
        with self.assertRaises(ValueError):
            P.signing_proof(status, listing.replace('sub:-:', 'sub:r:'), now)
        with self.assertRaises(ValueError):
            P.signing_proof(status, listing, now + P.M['metadataMaximumAgeMs'])

    def signing_witness_fixture(self):
        raw = (HERE / 'fixtures' / 'gpg-status-926291d6.json').read_bytes()
        self.assertEqual(P.digest(raw), 'ab511cd860788f7e61acb234b2a0f4de9b5c633770e0ad346f9be85186353efe')
        witness = P.json.loads(raw)
        for stream in witness['streams'].values():
            data = stream['text'].encode('utf-8')
            self.assertEqual((len(data), P.digest(data)), (stream['bytes'], stream['sha256']))
        return witness['streams']['status']['text'], witness['streams']['keyListing']['text'], witness['observedAtUnixMs']

    def test_actual_witness_accepts_only_identified_expired_unused_subkeys(self):
        status, listing, now = self.signing_witness_fixture()
        self.assertEqual(status.count('[GNUPG:] KEYEXPIRED '), 15)
        result = P.signing_proof(status, listing, now)
        self.assertEqual(result, {
            'primary': P.M['googlePrimaryFingerprint'],
            'signer': '0E225917414670F4442C250DFD533C07C264648F',
            'created': 1792011268000, 'expires': 0})
        without_notices = '\n'.join(line for line in status.splitlines() if not line.startswith('[GNUPG:] KEYEXPIRED ')) + '\n'
        self.assertEqual(P.signing_proof(without_notices, listing, now), result)

    def test_expired_notice_rejects_malformed_unmatched_or_unsafe_timestamp(self):
        status, listing, now = self.signing_witness_fixture()
        for replacement in ['', '0', '-1', '01', '1555048520.0', '1555048520 extra', '123', '9007199254741']:
            with self.subTest(timestamp=replacement), self.assertRaises(ValueError):
                P.signing_proof(status.replace('KEYEXPIRED 1555048520', 'KEYEXPIRED ' + replacement, 1), listing, now)

    def test_expired_notice_requires_one_bound_signature_sequence(self):
        status, listing, now = self.signing_witness_fixture()
        good = next(line for line in status.splitlines() if line.startswith('[GNUPG:] GOODSIG ')) + '\n'
        valid = next(line for line in status.splitlines() if line.startswith('[GNUPG:] VALIDSIG ')) + '\n'
        changed = [
            status.replace('[GNUPG:] NEWSIG\n', ''),
            status + '[GNUPG:] NEWSIG\n',
            '[GNUPG:] KEYEXPIRED 1555048520\n' + status,
            status.replace(good, ''),
            status + good,
            status.replace('GOODSIG FD533C07C264648F', 'GOODSIG 0000000000000000'),
            status.replace(good + valid, valid + good),
            status + valid,
        ]
        for index, altered in enumerate(changed):
            with self.subTest(sequence=index), self.assertRaises(ValueError):
                P.signing_proof(altered, listing, now)

    def test_expired_subkey_listing_timestamps_are_canonical_and_safe(self):
        status, listing, now = self.signing_witness_fixture()
        for field, original in [('created', '1460440520'), ('expires', '1555048520')]:
            replacements = [original + 'e0', original + '.0', original[:4] + '_' + original[4:],
                            '+' + original, '0' + original, '-' + original, '0',
                            ' ' + original, original + ' ', '9007199254741']
            for text in replacements:
                with self.subTest(field=field, text=text), self.assertRaises(ValueError):
                    P.signing_proof(status, listing.replace(':' + original + ':', ':' + text + ':', 1), now)

    def test_no_expired_notice_path_preserves_existing_listing_conversion(self):
        status, listing, now = self.signing_witness_fixture()
        status = '\n'.join(line for line in status.splitlines() if not line.startswith('[GNUPG:] KEYEXPIRED ')) + '\n'
        expected = P.signing_proof(status, listing, now)
        # This attribution-only correction must not change the established
        # no-notice path for unrelated unused keys.
        self.assertEqual(P.signing_proof(status, listing.replace(':1460440520:', ':1460_440520:', 1), now), expected)

    def test_expired_notice_rejects_ambiguous_or_incomplete_key_identity(self):
        status, listing, now = self.signing_witness_fixture()
        expired_fpr = '3B068FB4789ABE4AEFA3BB491397BC53640DB551'
        second_fpr = '3E50F6D3EC278FDEB655C8CA6494C6D6997C215E'
        fpr_row = 'fpr:::::::::' + expired_fpr + ':\n'
        collision = 'sub:e:4096:1:fixture:1460440520:1555048520:::::s::::::23:\nfpr:::::::::' + 'A' * 40 + ':\n'
        changed = [
            listing.replace(fpr_row, ''),
            listing.replace(fpr_row, fpr_row + fpr_row),
            listing.replace(expired_fpr, expired_fpr[:-1]),
            listing.replace(second_fpr, expired_fpr),
            listing + collision,
            collision + listing,
            listing.replace('sub:e:4096:1:1397BC53640DB551', 'sub:r:4096:1:1397BC53640DB551'),
            listing.replace('sub:e:4096:1:1397BC53640DB551', 'sub:-:4096:1:1397BC53640DB551'),
            listing.replace(':1460440520:1555048520:', ':1555048521:1555048520:'),
        ]
        for index, altered in enumerate(changed):
            with self.subTest(identity=index), self.assertRaises(ValueError):
                P.signing_proof(status, altered, now)
        future = now // 1000 + 3600
        with self.assertRaises(ValueError):
            P.signing_proof(status.replace('KEYEXPIRED 1555048520', 'KEYEXPIRED ' + str(future)),
                            listing.replace(':1555048520:', ':' + str(future) + ':'), now)

    def test_expired_notice_never_exempts_primary_signer_or_other_fatal_status(self):
        status, listing, now = self.signing_witness_fixture()
        for kind in ['pub', 'sub']:
            for invalid in ['r', 'e', 'd', 'i']:
                key_id = '7721F63BD38B4796' if kind == 'pub' else 'FD533C07C264648F'
                before = kind + ':-:4096:1:' + key_id
                after = kind + ':' + invalid + ':4096:1:' + key_id
                with self.subTest(key=kind, validity=invalid), self.assertRaises(ValueError):
                    P.signing_proof(status, listing.replace(before, after), now)
        for bad in ['BADSIG', 'ERRSIG', 'NO_PUBKEY', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYREVOKED', 'SIGEXPIRED', 'FAILURE', 'ERROR', 'NODATA']:
            with self.subTest(fatal=bad), self.assertRaises(ValueError):
                P.signing_proof(status + '[GNUPG:] ' + bad + ' fixture\n', listing, now)
        with self.assertRaises(ValueError):
            P.signing_proof(status, listing.replace(':1830876781:', ':1555048520:'), now)
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

    def ffmpeg_archive(self, path, changes=None):
        files = [('ffmpeg-linux', b'public-ffmpeg-fixture', 0o100755),
                 ('COPYING.LGPLv2.1', b'public-license-fixture', 0o100644)]
        if changes:
            files = changes(files)
        with P.zipfile.ZipFile(path, 'w') as archive:
            for name, data, mode in files:
                entry = P.zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = mode << 16
                archive.writestr(entry, data, compress_type=P.zipfile.ZIP_DEFLATED)
        raw = path.read_bytes()
        pin = P.json.loads(P.json.dumps(P.M['ffmpeg']))
        pin['archive'].update({'bytes': len(raw), 'sha256': P.digest(raw)})
        with P.zipfile.ZipFile(path) as archive:
            pin['files'] = [{'path': row.filename, 'bytes': row.file_size,
                             'compressedBytes': row.compress_size, 'mode': (row.external_attr >> 16) & 0o7777,
                             'sha256': P.digest(archive.read(row))} for row in archive.infolist()]
        return pin

    def test_ffmpeg_revision_matches_sri_bound_core_inventory(self):
        descriptor = {'name': 'ffmpeg', 'revision': '1011', 'revisionOverrides': {'mac12': '1010'}}
        P.ffmpeg_revision({'browsers': [descriptor]}, P.M['ffmpeg'])
        for entries in [[], [descriptor, descriptor], [{'name': 'ffmpeg', 'revision': '1009'}],
                        [{**descriptor, 'revisionOverrides': {'ubuntu22.04-x64': '1010'}}]]:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                P.ffmpeg_revision({'browsers': entries}, P.M['ffmpeg'])

    def test_ffmpeg_complete_regular_payload_is_verified_before_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive = root / 'ffmpeg.zip'
            pin = self.ffmpeg_archive(archive)
            destination = root / 'ffmpeg'
            P.extract_ffmpeg(archive, destination, pin)
            self.assertEqual({item.name for item in destination.iterdir()}, {'ffmpeg-linux', 'COPYING.LGPLv2.1'})
            for entry in pin['files']:
                target = destination / entry['path']
                self.assertEqual((target.stat().st_size, P.digest(target.read_bytes())), (entry['bytes'], entry['sha256']))
                self.assertEqual(target.stat().st_mode & 0o6000, 0)
            pin['files'][1]['sha256'] = '0' * 64
            rejected = root / 'not-created'
            with self.assertRaisesRegex(ValueError, 'payload digest mismatch'):
                P.extract_ffmpeg(archive, rejected, pin)
            self.assertFalse(rejected.exists())  # Neither binary nor license was written.

    def test_ffmpeg_zip_rejects_paths_duplicates_links_special_files_and_modes(self):
        changes = [
            lambda rows: rows[:1],
            lambda rows: rows + [('unexpected', b'x', 0o100644)],
            lambda rows: [rows[0], rows[0]],
            lambda rows: [('../ffmpeg-linux', rows[0][1], rows[0][2]), rows[1]],
            lambda rows: [('/ffmpeg-linux', rows[0][1], rows[0][2]), rows[1]],
            lambda rows: [('sub/ffmpeg-linux', rows[0][1], rows[0][2]), rows[1]],
        ]
        for mode in [0o120777, 0o040755, 0o020644, 0o104755, 0o100777]:
            changes.append(lambda rows, mode=mode: [(rows[0][0], rows[0][1], mode), rows[1]])
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for index, change in enumerate(changes):
                archive, destination = root / f'bad-{index}.zip', root / f'bad-{index}'
                with self.subTest(case=index):
                    pin = self.ffmpeg_archive(archive, change)
                    with self.assertRaises(ValueError):
                        P.extract_ffmpeg(archive, destination, pin)
                    self.assertFalse(destination.exists())

    def test_ffmpeg_zip_rejects_encoding_type_and_size_metadata_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / 'ffmpeg.zip'
            pin = self.ffmpeg_archive(archive)
            for attribute, value in [('flag_bits', 1), ('flag_bits', 8), ('compress_type', P.zipfile.ZIP_STORED),
                                     ('create_system', 0), ('file_size', 17 * 1024 * 1024),
                                     ('compress_size', 33 * 1024 * 1024), ('orig_filename', 'ffmpeg-linux\0extra')]:
                with self.subTest(attribute=attribute, value=value), P.zipfile.ZipFile(archive) as zipped:
                    members = zipped.infolist()
                    setattr(members[0], attribute, value)
                    with self.assertRaises(ValueError):
                        P.ffmpeg_members(members, pin)

    def test_ffmpeg_archive_tamper_and_truncation_fail_before_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for kind in ['tamper', 'truncate']:
                archive, destination = root / (kind + '.zip'), root / kind
                pin = self.ffmpeg_archive(archive)
                raw = archive.read_bytes()
                archive.write_bytes((bytes([raw[0] ^ 1]) + raw[1:]) if kind == 'tamper' else raw[:-1])
                with self.subTest(kind=kind), self.assertRaises(ValueError):
                    P.extract_ffmpeg(archive, destination, pin)
                self.assertFalse(destination.exists())

    def test_ffmpeg_download_only_accepts_fixed_final_https_url_and_no_redirect(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = pathlib.Path(directory) / 'download.zip'
            for url in [P.M['ffmpeg']['archive']['url'], 'http://playwright.download.prss.microsoft.com/ffmpeg.zip',
                        P.M['ffmpeg']['archive']['finalUrl'] + '?alternate=1']:
                with self.subTest(url=url), mock.patch.object(P.urllib.request, 'build_opener') as opener:
                    with self.assertRaisesRegex(ValueError, 'unreviewed public source'):
                        P.download(url, destination, 32 * 1024 * 1024)
                    opener.assert_not_called()
            body = b'public-download-fixture'
            response = mock.MagicMock()
            response.__enter__.return_value = response
            response.status, response.url = 200, P.M['ffmpeg']['archive']['finalUrl']
            response.read.side_effect = [body, b'']
            with mock.patch.object(P.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value = response
                record = P.download(response.url, destination, 32 * 1024 * 1024, P.digest(body), len(body))
                opener.return_value.open.assert_called_once_with(response.url, timeout=30)
                self.assertEqual(record, {'sha256': P.digest(body), 'bytes': len(body)})
                self.assertEqual(destination.read_bytes(), body)
            with self.assertRaisesRegex(ValueError, 'redirect prohibited'):
                P.NoRedirect().redirect_request(None, None, 307, '', {}, P.M['ffmpeg']['archive']['finalUrl'])

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
