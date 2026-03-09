const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableRequestError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status = error.response?.status;

  if (status == null) {
    return true;
  }

  return RETRYABLE_STATUS_CODES.has(status);
}

function wait(ms, sleep = setTimeout) {
  if (!ms) {
    return Promise.resolve();
  }

  return new Promise((resolve) => sleep(resolve, ms));
}

async function requestWithCache({
  cache,
  key,
  execute,
  ttlMs = 30_000,
  staleTtlMs = 300_000,
  retries = 2,
  retryDelayMs = 600,
  now = Date.now,
  sleep = setTimeout
}) {
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') {
    throw new TypeError('A cache informada precisa implementar get() e set().');
  }

  if (typeof execute !== 'function') {
    throw new TypeError('A operação execute precisa ser uma função.');
  }

  const currentTime = now();
  const cachedEntry = cache.get(key);
  const hasFreshEntry = cachedEntry && currentTime - cachedEntry.timestamp <= ttlMs;

  if (hasFreshEntry) {
    return cachedEntry.value;
  }

  const hasStaleEntry = cachedEntry && currentTime - cachedEntry.timestamp <= staleTtlMs;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const value = await execute();
      cache.set(key, {
        value,
        timestamp: now()
      });
      return value;
    } catch (error) {
      lastError = error;

      if (attempt < retries && isRetryableRequestError(error)) {
        await wait(retryDelayMs * (attempt + 1), sleep);
        continue;
      }

      if (hasStaleEntry) {
        return cachedEntry.value;
      }

      throw error;
    }
  }

  if (hasStaleEntry) {
    return cachedEntry.value;
  }

  throw lastError;
}

module.exports = {
  isRetryableRequestError,
  requestWithCache
};
