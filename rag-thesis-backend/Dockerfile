FROM python:3.12-slim

# Tesseract OCR binary for scanned-manuscript digitization
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py config.py models.py ./
COPY routers/*.py ./routers/
COPY services/*.py ./services/
COPY dependencies/*.py ./dependencies/

# Run as an unprivileged user (never root in production)
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=4).status == 200 else 1)"]

# Proxy headers are accepted only from Uvicorn's trusted default unless the
# deployment explicitly sets FORWARDED_ALLOW_IPS to its known reverse proxy.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
