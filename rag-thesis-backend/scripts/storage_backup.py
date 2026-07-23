"""Encrypted Supabase Storage backup, verification, and local-only restore."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from supabase import create_client

MAGIC = b'ISU-STORAGE1'
SALT_BYTES = 16
NONCE_BYTES = 12
TAG_BYTES = 16
CHUNK_BYTES = 1024 * 1024
BUCKETS = ('pdfs', 'avatars')


def _key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode())


def _encrypt(source: Path, target: Path, passphrase: str) -> None:
    salt, nonce = os.urandom(SALT_BYTES), os.urandom(NONCE_BYTES)
    encryptor = Cipher(algorithms.AES(_key(passphrase, salt)), modes.GCM(nonce)).encryptor()
    with source.open('rb') as src, target.open('wb') as dst:
        dst.write(MAGIC + salt + nonce)
        while block := src.read(CHUNK_BYTES):
            dst.write(encryptor.update(block))
        dst.write(encryptor.finalize())
        dst.write(encryptor.tag)


def _decrypt(source: Path, target: Path, passphrase: str) -> None:
    size = source.stat().st_size
    header_size = len(MAGIC) + SALT_BYTES + NONCE_BYTES
    if size <= header_size + TAG_BYTES:
        raise ValueError('Encrypted storage backup is incomplete')
    with source.open('rb') as src:
        if src.read(len(MAGIC)) != MAGIC:
            raise ValueError('Not an ISU encrypted storage backup')
        salt, nonce = src.read(SALT_BYTES), src.read(NONCE_BYTES)
        src.seek(-TAG_BYTES, os.SEEK_END)
        tag = src.read(TAG_BYTES)
        src.seek(header_size)
        remaining = size - header_size - TAG_BYTES
        decryptor = Cipher(algorithms.AES(_key(passphrase, salt)), modes.GCM(nonce, tag)).decryptor()
        with target.open('wb') as dst:
            while remaining:
                block = src.read(min(CHUNK_BYTES, remaining))
                if not block:
                    raise ValueError('Encrypted storage backup ended unexpectedly')
                remaining -= len(block)
                dst.write(decryptor.update(block))
            dst.write(decryptor.finalize())


def _objects(store, prefix: str = ''):
    offset = 0
    while True:
        rows = store.list(prefix, {'limit': 1000, 'offset': offset}) or []
        if not rows:
            break
        for row in rows:
            name = str(row.get('name') or '')
            path = str(PurePosixPath(prefix, name)) if prefix else name
            if row.get('id'):
                yield path
            else:
                yield from _objects(store, path)
        if len(rows) < 1000:
            break
        offset += len(rows)


def _passphrase(confirm: bool = False) -> str:
    value = os.getenv('BACKUP_PASSPHRASE') or getpass.getpass('Backup passphrase: ')
    if len(value) < 12:
        raise ValueError('Use a backup passphrase of at least 12 characters')
    if confirm and not os.getenv('BACKUP_PASSPHRASE'):
        if value != getpass.getpass('Confirm passphrase: '):
            raise ValueError('Passphrases did not match')
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(CHUNK_BYTES):
            digest.update(block)
    return digest.hexdigest()


def _object_file(root: Path, bucket: str, object_path: str) -> Path:
    """Resolve an object path without permitting archive/path traversal."""
    if not isinstance(bucket, str) or bucket not in BUCKETS:
        raise ValueError('Storage backup contains an unknown bucket')
    if not isinstance(object_path, str):
        raise ValueError('Storage backup contains an unsafe object path')
    pure = PurePosixPath(object_path)
    if pure.is_absolute() or not pure.parts or any(part in {'', '.', '..'} for part in pure.parts):
        raise ValueError('Storage backup contains an unsafe object path')
    base = (root / 'objects' / bucket).resolve()
    candidate = (base / Path(*pure.parts)).resolve()
    if candidate != base and base not in candidate.parents:
        raise ValueError('Storage backup object escaped its bucket directory')
    return candidate


def _safe_extract(archive: Path, target: Path) -> None:
    with tarfile.open(archive, 'r:gz') as tar:
        tar.extractall(target, filter='data')


def _verify_tree(root: Path) -> dict:
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 1 or not isinstance(manifest.get('objects'), list):
        raise ValueError('Storage backup manifest format is invalid')
    seen_objects = set()
    for item in manifest['objects']:
        if not isinstance(item, dict):
            raise ValueError('Storage backup manifest format is invalid')
        object_key = (item.get('bucket'), item.get('path'))
        if object_key in seen_objects:
            raise ValueError('Storage backup manifest contains a duplicate object')
        seen_objects.add(object_key)
        path = _object_file(root, item.get('bucket'), item.get('path'))
        digest = item.get('sha256')
        if not isinstance(digest, str) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('A stored object failed integrity verification')
    return manifest


def backup(args) -> None:
    key = args.key or os.getenv('SUPABASE_BACKUP_KEY')
    if not key:
        raise ValueError('Provide the service key through SUPABASE_BACKUP_KEY')
    client = create_client(args.url, key)
    destination = Path(args.output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='isu-storage-backup-') as temp:
        root = Path(temp)
        (root / 'objects').mkdir()
        objects = []
        for bucket in BUCKETS:
            store = client.storage.from_(bucket)
            for object_path in _objects(store):
                payload = store.download(object_path)
                local = _object_file(root, bucket, object_path)
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(payload)
                objects.append({
                    'bucket': bucket, 'path': object_path, 'size': len(payload),
                    'sha256': hashlib.sha256(payload).hexdigest(),
                })
        manifest = {
            'format': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
            'objects': objects,
        }
        (root / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')
        archive = root / 'storage.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            tar.add(root / 'objects', arcname='objects')
            tar.add(root / 'manifest.json', arcname='manifest.json')
        _encrypt(archive, destination, _passphrase(confirm=True))
    report = {
        'created_at': manifest['created_at'],
        'encrypted_archive_sha256': _sha256_file(destination),
        'object_count': len(objects),
        'total_plaintext_bytes': sum(item['size'] for item in objects),
        'bucket_counts': {bucket: sum(item['bucket'] == bucket for item in objects) for bucket in BUCKETS},
    }
    destination.with_suffix(destination.suffix + '.report.json').write_text(
        json.dumps(report, indent=2), encoding='utf-8',
    )
    print(json.dumps(report, indent=2))


def unpack_verified(source: Path, passphrase: str, target: Path) -> dict:
    archive = target / 'storage.tar.gz'
    _decrypt(source, archive, passphrase)
    extracted = target / 'verified'
    extracted.mkdir()
    _safe_extract(archive, extracted)
    return _verify_tree(extracted)


def verify(args) -> None:
    with tempfile.TemporaryDirectory(prefix='isu-storage-verify-') as temp:
        manifest = unpack_verified(Path(args.input).resolve(), _passphrase(), Path(temp))
    print(json.dumps({
        'verified': True,
        'object_count': len(manifest['objects']),
        'total_plaintext_bytes': sum(item['size'] for item in manifest['objects']),
    }, indent=2))


def restore(args) -> None:
    host = (urlparse(args.url).hostname or '').lower()
    if host not in {'localhost', '127.0.0.1', 'host.docker.internal'}:
        raise ValueError('Restore target rejected: only a disposable local Supabase URL is allowed')
    key = args.key or os.getenv('SUPABASE_BACKUP_KEY')
    if not key:
        raise ValueError('Provide the local service key through SUPABASE_BACKUP_KEY')
    client = create_client(args.url, key)
    with tempfile.TemporaryDirectory(prefix='isu-storage-restore-') as temp:
        root = Path(temp)
        manifest = unpack_verified(Path(args.input).resolve(), _passphrase(), root)
        restored = 0
        for item in manifest['objects']:
            local = _object_file(root / 'verified', item['bucket'], item['path'])
            client.storage.from_(item['bucket']).upload(
                item['path'], local.read_bytes(), {'upsert': 'true'},
            )
            restored += 1
    print(json.dumps({'restored_to_local_only': True, 'object_count': restored}, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(required=True)
    create = commands.add_parser('backup')
    create.add_argument('--url', required=True)
    create.add_argument('--key')
    create.add_argument('--output', required=True)
    create.set_defaults(run=backup)
    check = commands.add_parser('verify')
    check.add_argument('--input', required=True)
    check.set_defaults(run=verify)
    recover = commands.add_parser('restore-local')
    recover.add_argument('--url', required=True)
    recover.add_argument('--key')
    recover.add_argument('--input', required=True)
    recover.set_defaults(run=restore)
    return result


if __name__ == '__main__':
    arguments = parser().parse_args()
    arguments.run(arguments)
