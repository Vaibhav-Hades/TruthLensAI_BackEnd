/**
 * apiClient.js
 * 
 * PHASE 7 V2: Production-Grade API Resilience
 */

const axios = require('axios');

/**
 * Robust fetch utility with exponential backoff, retries, and timeout handling.
 */
async function robustFetch(config, options = {}) {
  const {
    retries = 3,
    initialDelay = 1500,
    timeout = 25000,
    stage = 'api-call'
  } = options;

  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        ...config,
        timeout: timeout,
        headers: {
          ...config.headers,
          'User-Agent': 'TruthLens-Production-Engine/2.0'
        }
      });
      return response.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRateLimit = status === 429;
      const isNetworkError = !err.response || err.code === 'ECONNABORTED';
      const isServerError = status >= 500;

      // Log the failure
      console.warn(`[${stage}] Attempt ${i + 1}/${retries + 1} failed: ${err.message}`);

      if (i < retries && (isRateLimit || isNetworkError || isServerError)) {
        // Longer delay for rate limits
        const backoffMultiplier = isRateLimit ? 3 : 2;
        const delay = initialDelay * Math.pow(backoffMultiplier, i);
        
        console.info(`[${stage}] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      break;
    }
  }

  console.error(`[${stage}] ❌ Critical API failure after ${retries + 1} attempts.`);
  throw lastError;
}

module.exports = { robustFetch };
