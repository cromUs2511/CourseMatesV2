export const SESSION_EXPIRED_EVENT = 'coursemates:session-expired';

export async function apiRequest<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 401 && path !== '/api/auth/session') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new Error('Your session ended. Continue to start a new anonymous session.');
  }
  if (!response.ok) throw new Error(data?.error || 'The service is unavailable. Please try again.');
  if (!data) throw new Error('The server returned an invalid response.');
  return data as T;
}
