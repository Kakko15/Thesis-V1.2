# Pinned by digest, not by tag. `:latest-dev` is a moving tag that Chainguard
# rebuilds continuously, so the interpreter assertion below could start failing
# on an unrelated commit with nothing in this repository having changed. The tag
# is kept alongside for readability; the digest is what resolves.
#
# Digest resolved 2026-08-25 and verified locally: the image builds and Trivy
# reports 0 CRITICAL/HIGH with --ignore-unfixed. Dependabot's docker ecosystem
# keeps it current — see .github/dependabot.yml. Chainguard's free tier retains
# only the newest build, so a stale digest eventually fails to pull with
# "manifest unknown"; that is a loud, obvious failure, which is the point.
#
# The previous pin (2026-08-02/03 builds) went 21 days stale and shipped
# openssl 3.6.3-r3, which carries CVE-2026-14456 — a HIGH, fix-available DoS in
# OpenSSL's QUIC server. Nothing here serves QUIC, so exposure was nil, but the
# CI container scan is fix-available-only and failed on it for eight
# consecutive runs. Re-pinning to a build carrying 3.6.3-r5 clears it.
FROM cgr.dev/chainguard/python:latest-dev@sha256:3472bbd8c7a7fe9254dcccdbd8eefb8edf603d0882aa4ed527f8497957b10f5f AS build

USER root
# Deliberately exact, not a range: the paper's version tables record this
# number, so a silent patch bump would make them wrong. Re-pinning the digest
# above is the moment to confirm this number and the tables together — and it
# worked: the 2026-08-25 re-pin moved the interpreter 3.14.6 -> 3.14.7 and this
# assertion caught it, rather than letting the tables drift silently.
# Keep .github/workflows/quality.yml, README.md, and the paper's Tables 1-4 in
# step with whatever this line says.
RUN python -c "import sys; assert sys.version_info[:3] == (3, 14, 7), sys.version"

WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install from the hash-locked resolution, not requirements.txt. --require-hashes
# makes pip verify every distribution's SHA-256 and refuse anything unpinned, so
# a compromised or substituted transitive dependency fails the build instead of
# shipping. requirements.txt remains the human-readable statement of intent;
# tests/test_dependency_lock.py keeps the two from drifting apart.
COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
RUN python -c "import tessdata, tesserocr; path=tessdata.data_path(); assert 'eng' in tesserocr.get_languages(path)[1]; print(tesserocr.tesseract_version())"

# Resolve and cache the fixed tokenizer vocabulary at build time so runtime
# chunking never depends on a network request.
ENV TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache
RUN mkdir -p "$TIKTOKEN_CACHE_DIR" \
    && python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')" \
    && chmod -R a+rX "$TIKTOKEN_CACHE_DIR"

# Build tooling is not needed at runtime and carries vendored packages that
# unnecessarily expand the production image's vulnerability surface.
RUN pip uninstall --yes pip setuptools

# Every root-level module the API and the worker import at startup. A module
# added there but not here fails the image at import, and CI only builds and
# scans the image; tests/test_dockerfile_contents.py guards this list.
COPY main.py config.py models.py warning_filters.py ./
COPY routers/*.py ./routers/
COPY services/*.py ./services/
COPY dependencies/*.py ./dependencies/
COPY workers/*.py ./workers/
COPY scripts/gemini_release_smoke.py ./scripts/
RUN chown -R 65532:65532 /app /opt/venv /opt/tiktoken-cache

# Runtime stage, pinned by digest for the same reason as the build stage above.
FROM cgr.dev/chainguard/python:latest@sha256:27c8d0e215a516e6d366549d1673baf6c42784277afcc8d904715a73982b9ba4

WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache

COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/tiktoken-cache /opt/tiktoken-cache
COPY --from=build --chown=65532:65532 /app /app

USER 65532:65532
ENTRYPOINT []

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=4).status == 200 else 1)"]

# Proxy headers are accepted only from Uvicorn's trusted default unless the
# deployment explicitly sets FORWARDED_ALLOW_IPS to its known reverse proxy.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
