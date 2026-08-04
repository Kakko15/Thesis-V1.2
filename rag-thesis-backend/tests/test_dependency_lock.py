"""Supply-chain guards for the hash-locked dependency set (S3 / item 19).

`requirements.txt` stays the human-readable statement of intent — the file the
paper's version tables are generated from. `requirements.lock` is what actually
gets installed: the same direct pins plus every transitive dependency, each with
the SHA-256 hashes of its distributions, so `pip install --require-hashes`
refuses anything that does not match byte for byte.

The failure mode these tests exist for is drift. A direct pin bumped in
requirements.txt without regenerating the lock would leave the container quietly
installing the old version, and the reverse would make the paper's tables wrong.
Neither shows up as an error anywhere else.
"""

import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
REQUIREMENTS = BACKEND / 'requirements.txt'
LOCK = BACKEND / 'requirements.lock'

_DIRECT = re.compile(r'^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==(\S+)$')
_LOCKED = re.compile(r'^([A-Za-z0-9_.-]+)==([^\s\\]+)')


def normalize(name: str) -> str:
    """PEP 503 normalization: `tessdata.eng` and `tessdata-eng` are one package."""
    return re.sub(r'[-_.]+', '-', name).lower()


def read_direct_pins() -> dict[str, str]:
    pins = {}
    for raw in REQUIREMENTS.read_text(encoding='utf-8').splitlines():
        line = raw.split('#')[0].strip()
        match = _DIRECT.match(line)
        if match:
            pins[normalize(match.group(1))] = match.group(2)
    return pins


def read_locked_versions() -> dict[str, str]:
    versions = {}
    for raw in LOCK.read_text(encoding='utf-8').splitlines():
        match = _LOCKED.match(raw)
        if match:
            versions[normalize(match.group(1))] = match.group(2)
    return versions


def read_locked_hashes() -> dict[str, set[str]]:
    hashes: dict[str, set[str]] = {}
    current = None
    for raw in LOCK.read_text(encoding='utf-8').splitlines():
        match = _LOCKED.match(raw)
        if match:
            current = normalize(match.group(1))
            hashes.setdefault(current, set())
        if current:
            hashes[current].update(re.findall(r'--hash=(sha256:[0-9a-f]{64})', raw))
    return hashes


class TestTheLockExists:
    def test_the_lock_file_is_present(self):
        assert LOCK.is_file(), (
            'requirements.lock is missing. Regenerate it with:\n'
            '  uv pip compile requirements.txt --generate-hashes '
            '--python-platform x86_64-unknown-linux-gnu --python-version 3.14 '
            '--output-file requirements.lock'
        )

    def test_the_parsers_are_not_vacuous(self):
        """Guard the guards: a broken regex would make every check below pass."""
        direct = read_direct_pins()
        locked = read_locked_versions()
        assert len(direct) >= 20, direct
        assert len(locked) > len(direct), 'the lock must add transitive dependencies'
        assert 'fastapi' in direct and 'fastapi' in locked


class TestTheLockAgreesWithRequirements:
    def test_every_direct_pin_is_locked_at_the_same_version(self):
        direct = read_direct_pins()
        locked = read_locked_versions()
        drifted = {
            name: (version, locked.get(name))
            for name, version in direct.items()
            if locked.get(name) != version
        }
        assert not drifted, (
            'requirements.txt and requirements.lock disagree '
            f'(name: requirements, lock): {drifted}. Regenerate the lock.'
        )

    def test_the_lock_pins_a_single_version_per_package(self):
        seen: dict[str, int] = {}
        for raw in LOCK.read_text(encoding='utf-8').splitlines():
            match = _LOCKED.match(raw)
            if match:
                key = normalize(match.group(1))
                seen[key] = seen.get(key, 0) + 1
        duplicated = {name: count for name, count in seen.items() if count > 1}
        assert not duplicated, f'packages pinned more than once: {duplicated}'


class TestEveryLockedPackageIsHashed:
    """`--require-hashes` fails the whole install if any single requirement lacks
    a hash, so an unhashed entry would break the container build rather than
    weaken it quietly. Catching it here is cheaper than catching it in CI."""

    def test_no_locked_package_is_missing_its_hashes(self):
        hashes = read_locked_hashes()
        unhashed = sorted(name for name, digests in hashes.items() if not digests)
        assert not unhashed, f'locked packages with no --hash entry: {unhashed}'

    def test_hashes_are_well_formed_sha256(self):
        text = LOCK.read_text(encoding='utf-8')
        declared = re.findall(r'--hash=(\S+)', text)
        assert declared, 'the lock declares no hashes at all'
        malformed = [value for value in declared
                     if not re.fullmatch(r'sha256:[0-9a-f]{64}', value)]
        assert not malformed, f'malformed hash entries: {malformed[:5]}'


class TestTheLockTargetsTheDeploymentPlatform:
    """Resolved on Windows, this lock would omit tesserocr's manylinux wheels and
    the container build would fail on a missing hash. The header records the
    resolve target so a regeneration on the wrong platform is visible in review."""

    def test_the_header_records_a_linux_resolve(self):
        header = LOCK.read_text(encoding='utf-8')[:600]
        assert 'linux' in header, header

    def test_the_linux_only_ocr_stack_is_locked(self):
        locked = read_locked_versions()
        for package in ('tesserocr', 'tessdata-eng'):
            assert package in locked, f'{package} missing from the lock'


class TestTheCryptographyFixIsHeld:
    """CVE-2026-69247 affects cryptography 44.0.0 through 49.x. Both files must
    stay at or above the fix, in lockstep."""

    @pytest.mark.parametrize('source', ['requirements', 'lock'])
    def test_cryptography_is_at_least_the_fixed_version(self, source):
        versions = read_direct_pins() if source == 'requirements' else read_locked_versions()
        major = int(versions['cryptography'].split('.')[0])
        assert major >= 50, f'{source} has cryptography {versions["cryptography"]}'
