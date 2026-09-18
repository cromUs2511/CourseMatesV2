export type PythonOrchestratorMode = 'off' | 'shadow';

export type PythonOrchestratorConfig = {
  mode: PythonOrchestratorMode;
  baseUrl: string;
  timeoutMs: number;
};

export type IcebreakerObservation = {
  topic: string;
  discipline: string;
  campus: string;
};

export type MatchParticipantObservation = {
  id: string;
  verified: boolean;
  interests: string[];
  allowNormal: boolean;
};

export type MatchObservation = {
  candidate: MatchParticipantObservation;
  queued: MatchParticipantObservation[];
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createPythonOrchestratorClient(
  config: PythonOrchestratorConfig,
  fetchImpl: FetchLike = fetch,
) {
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  async function observe(path: string, body: Record<string, unknown>): Promise<void> {
    if (config.mode !== 'shadow') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      await fetchImpl(baseUrl + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractVersion: 1, ...body }), signal: controller.signal,
      });
    } catch {
      // Shadow work must never alter the legacy request outcome.
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async observeIcebreakers(input: IcebreakerObservation): Promise<void> {
      await observe('/internal/v1/icebreakers', input);
    },
    async observeMatch(input: MatchObservation): Promise<void> {
      await observe('/internal/v1/match/select', input);
    },
  };
}

export function pythonOrchestratorConfig(env: NodeJS.ProcessEnv = process.env): PythonOrchestratorConfig {
  return {
    mode: env.PYTHON_ORCHESTRATOR_MODE === 'shadow' ? 'shadow' : 'off',
    baseUrl: env.PYTHON_ORCHESTRATOR_URL || 'http://127.0.0.1:5051',
    timeoutMs: Math.max(50, Math.min(Number(env.PYTHON_ORCHESTRATOR_TIMEOUT_MS) || 500, 5000)),
  };
}
