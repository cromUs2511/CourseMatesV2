FROM python:3.12-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake && rm -rf /var/lib/apt/lists/*
COPY native /app/native
COPY services/python-orchestrator/requirements.txt /app/requirements.txt
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r /app/requirements.txt /app/native

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels && useradd --system --uid 10001 --no-create-home app
COPY --chown=app:app services/python-orchestrator/app /app/app
COPY --chown=app:app native_bridge.py /app/native_bridge.py
USER app
EXPOSE 5051
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:5051/internal/v1/health', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5051", "--workers", "1", "--no-access-log"]
