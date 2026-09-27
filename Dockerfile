# =============================================================================
# Vera — magicpin AI Challenge Bot
# Multi-stage build: python:3.11-slim, exposes port 8080
# =============================================================================

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Copy requirements first for layer caching
COPY requirements.txt .

# Install into an isolated prefix so we can copy cleanly
RUN pip install --upgrade pip --no-cache-dir \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Non-root user for security
RUN useradd --create-home --shell /bin/bash vera

WORKDIR /app

# Pull installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY bot.py .

# Switch to non-root
USER vera

# Expose the judge harness port
EXPOSE 8080

# Health-check so orchestrators know when Vera is ready
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/v1/healthz')" \
    || exit 1

# ── Runtime environment defaults (override via -e or --env-file) ──────────────
ENV LLM_PROVIDER=openai \
    LLM_MODEL="" \
    LLM_API_KEY="" \
    OPENAI_BASE_URL="https://api.openai.com/v1" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Launch Vera
CMD ["python", "-m", "uvicorn", "bot:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--log-level", "info"]
