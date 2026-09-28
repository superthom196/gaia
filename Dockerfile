FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_RETRIES=10 \
    PIP_RESUME_RETRIES=10 \
    GAIA_CHROMIUM=/usr/bin/chromium \
    GAIA_DATA=/data

WORKDIR /app

# The TV renderer runs Debian's Chromium (Playwright drives it; Playwright's
# own download server timed out from nexiom0), on the box's GPU when there
# is one: Mesa's EGL/GL drivers for rendering and its VA-API driver for
# hardware video encoding. tzdata lets TZ set the time the TV stream shows.
# Downloads retry and resume: nexiom0's connection drops large transfers now
# and then (plain HTTP arrived corrupted, HTTPS gets cut off mid-file).
RUN sed -i 's,http://deb.debian.org,https://deb.debian.org,g' /etc/apt/sources.list.d/debian.sources \
    && echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium libegl1 libgles2 \
       libgl1-mesa-dri mesa-va-drivers tzdata \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, in their own layer, so a code change doesn't fetch
# them again; retried as a whole in case a download is cut off.
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && for i in 1 2 3 4 5; do pip install --no-cache-dir -r /tmp/requirements.txt && break; sleep 5; done \
    && pip show fastapi playwright eccodes > /dev/null

COPY gaia ./gaia
RUN pip install --no-cache-dir --no-deps .

EXPOSE 8040

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request as u; u.urlopen(f'http://127.0.0.1:{os.environ.get(\"GAIA_PORT\", \"8040\")}/health', timeout=3)" || exit 1

# One worker: the scheduler and the TV renderers are in-process state.
CMD ["sh", "-c", "exec uvicorn gaia.asgi:app --host \"${GAIA_HOST:-127.0.0.1}\" --port \"${GAIA_PORT:-8040}\" --workers 1 --ws-ping-interval 20"]
