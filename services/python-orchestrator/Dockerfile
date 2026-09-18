FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake && rm -rf /var/lib/apt/lists/*
COPY native /app/native
COPY services/python-orchestrator/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt && pip install --no-cache-dir /app/native
COPY services/python-orchestrator/app /app/app
EXPOSE 5051
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5051"]
