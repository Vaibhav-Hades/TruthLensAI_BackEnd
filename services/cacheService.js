/**
 * cacheService.js
 * 
 * PHASE 7 V2: Production-Grade Intelligent Caching
 */

const crypto = require('crypto');

class CacheService {
  constructor() {
    this.cache = new Map();
    this.DEFAULT_TTL = 1000 * 60 * 60 * 12; // 12 hours for production
  }

  /**
   * Retrieve item from cache
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      console.log(`[cache] 🗑️ Expired key removed: ${key.slice(0, 20)}...`);
      return null;
    }
    
    console.log(`[cache] ⚡ Hit: ${key.slice(0, 20)}...`);
    return entry.value;
  }

  /**
   * Set item in cache
   */
  set(key, value, ttl = this.DEFAULT_TTL) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
    
    // Auto-prune old entries if cache grows too large (> 1000 items)
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Generate a cryptographic SHA-256 hash for stable key identification
   */
  generateKey(prefix, data) {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const hash = crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex')
      .slice(0, 32); // 32 chars is enough for unique collision-free keys
    
    return `${prefix}:${hash}`;
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    console.log('[cache] 🧼 Cache cleared.');
  }
}

module.exports = new CacheService();
