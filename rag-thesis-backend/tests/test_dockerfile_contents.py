"""Keep the Dockerfile's COPY list in step with what the processes import.

The image copies named files and directories rather than the whole tree, so a
new root-level module is invisible to it until someone remembers the Dockerfile.
`warning_filters.py` was added on 2026-09-02 and imported first thing by both
`main.py` and the ingestion worker; the image built green in CI, which only
builds and scans it, and failed on `docker run` with ModuleNotFoundError.

These tests resolve the first-party imports of the two entrypoints and assert
that every one of them is covered by a COPY instruction. Coverage is at the
granularity the Dockerfile uses: a root-level file must be named, a package is
covered when any path under its directory is copied.
"""

import ast
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
DOCKERFILE = BACKEND / 'Dockerfile'
ENTRYPOINTS = (BACKEND / 'main.py', BACKEND / 'workers' / 'ingestion_worker.py')


def copied_sources() -> set[str]:
    """Source paths named by build-stage COPY instructions, as written."""
    sources: set[str] = set()
    for line in DOCKERFILE.read_text(encoding='utf-8').splitlines():
        match = re.match(r'\s*COPY\s+(?!--from)(.+?)\s+\S+\s*$', line)
        if match:
            sources.update(match.group(1).split())
    return sources


def first_party_top_level_imports(path: pathlib.Path) -> set[str]:
    """Top-level names imported anywhere in `path` that resolve to backend code."""
    tree = ast.parse(path.read_text(encoding='utf-8'))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split('.')[0])
    return {
        name for name in names
        if (BACKEND / f'{name}.py').is_file() or (BACKEND / name).is_dir()
    }


def is_copied(name: str, sources: set[str]) -> bool:
    if (BACKEND / f'{name}.py').is_file():
        return f'{name}.py' in sources
    return any(source.startswith(f'{name}/') for source in sources)


@pytest.mark.parametrize('entrypoint', ENTRYPOINTS, ids=lambda path: path.name)
def test_every_first_party_import_of_an_entrypoint_is_copied_into_the_image(entrypoint):
    sources = copied_sources()
    missing = sorted(
        name for name in first_party_top_level_imports(entrypoint)
        if not is_copied(name, sources)
    )
    assert not missing, (
        f'{entrypoint.name} imports {missing}, which the Dockerfile never copies; '
        'the container would fail at import'
    )


def test_warning_filters_is_named_explicitly():
    """The concrete regression: the module both entrypoints import first."""
    assert 'warning_filters.py' in copied_sources()
