"""Filters for third-party import warnings this backend cannot act on.

`langchain_core` imports `pydantic.v1` at module scope (output parsers,
runnables, tools), and that compatibility shim warns unconditionally on
Python 3.14:

    UserWarning: Core Pydantic V1 functionality isn't compatible with
    Python 3.14 or greater.

Nothing here defines or validates a Pydantic V1 model - every schema in
`models.py` and `config.py` is V2 - so the import only backs LangChain's
internal `isinstance` checks and the warning is start-up noise on the API
server, the ingestion worker, and the evaluation runs.

The filter matches that one message rather than silencing `UserWarning`
wholesale, so an unrelated warning still reaches the log.
"""

from __future__ import annotations

import warnings

_PYDANTIC_V1_ON_PY314 = (
    r"Core Pydantic V1 functionality isn't compatible with Python 3\.14 or greater\."
)


def silence_known_third_party_warnings() -> None:
    """Register the filters. Call before importing anything from ``langchain*``.

    A warning already emitted cannot be taken back, so this has no effect once
    the importing module has been executed.
    """
    warnings.filterwarnings('ignore', message=_PYDANTIC_V1_ON_PY314, category=UserWarning)
