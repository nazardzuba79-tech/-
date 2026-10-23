"""Static packaging regression — does NOT start any image or connect to production."""
import ast
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCKERFILE = (ROOT / "release/demo-off/Dockerfile").read_text(encoding="utf-8")
PACKAGER = (ROOT / "scripts/package-demo-off-api.py").read_text(encoding="utf-8")

def runtime_names():
    module = ast.parse(PACKAGER)
    assignments = [n for n in module.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == "runtime" for t in n.targets)]
    if len(assignments) != 1:
        raise AssertionError("runtime allowlist missing or ambiguous")
    return ast.literal_eval(assignments[0].value)

class PermissionsContract(unittest.TestCase):
    def test_exactly_twenty_four_nonroot_readable_copy_rules(self):
        paths = [name + ext for name in runtime_names() for ext in (".js", ".js.map")]
        self.assertEqual(len(paths), 24)
        expected = [
            "COPY --chown=1000:1000 --chmod=0644 overlay/" + path + " /app/dist/" + path
            for path in paths
        ]
        actual = [line for line in DOCKERFILE.splitlines() if line.startswith("COPY ")]
        self.assertEqual(actual, expected)
        self.assertNotIn("COPY overlay/ /app/dist/", DOCKERFILE)
        self.assertFalse(any(line.startswith("RUN ") for line in DOCKERFILE.splitlines()))

    def test_no_feature_or_migration_activation(self):
        for flag in ["DEMO_SPOT_ENABLED=false", "DEMO_LIQUIDITY_ENABLED=false",
                     "DEMO_WITHDRAWAL_GUARD_ENABLED=false"]:
            self.assertIn(flag, DOCKERFILE)
        self.assertIn('CMD ["node", "dist/index.js"]', DOCKERFILE)
        self.assertNotRegex(DOCKERFILE, r"(?im)^\\s*RUN\\s+.*(?:prisma|migration|npm|curl)")

    def test_packager_retains_portable_file_and_directory_permissions(self):
        self.assertIn("expected_copy_lines", PACKAGER)
        self.assertIn("assert copy_lines == expected_copy_lines", PACKAGER)
        self.assertIn("info.mode=0o644;info.uid=1000;info.gid=1000", PACKAGER)
        self.assertIn("info.mode=0o755;info.uid=1000;info.gid=1000", PACKAGER)
        self.assertIn("'mode':'0644'", PACKAGER)
        self.assertEqual(len(runtime_names()), 12)
        for directory in ["overlay/api/routes", "overlay/services"]:
            self.assertIn(directory, PACKAGER)

if __name__ == "__main__":
    unittest.main(verbosity=2)
