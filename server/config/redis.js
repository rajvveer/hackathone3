const Redis = require('ioredis');

let redis = null;

/**
 * Initialize Redis connection with graceful degradation.
 * If Redis is unavailable, the system falls back to MongoDB cache only.
 * Supports both local Redis and cloud Redis (Upstash, Redis Cloud) via REDIS_URL.
 */
const connectRedis = () => {
  try {
    const retryStrategy = (times) => {
      if (times > 3) {
        console.warn('⚠️  Redis: Max retries reached — disabling Redis cache. MongoDB cache still active.');
        return null; // stop retrying, but DON'T crash the app
      }
      return Math.min(times * 300, 3000);
    };

    if (process.env.REDIS_URL) {
      // Cloud Redis (Upstash, Redis Cloud, Railway Redis)
      redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy,
        tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
      });
    } else {
      // Local Redis
      redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy,
      });
    }

    redis.on('connect', () => {
      console.log('⚡ Redis connected — two-tier cache active (Redis + MongoDB)');
    });

    redis.on('error', (err) => {
      // Suppress noisy ECONNREFUSED logs after initial failure
      if (err.code !== 'ECONNREFUSED') {
        console.warn('⚠️  Redis error:', err.message);
      }
    });

    redis.on('close', () => {
      console.warn('⚠️  Redis connection closed');
    });

  } catch (err) {
    console.warn('⚠️  Redis init failed:', err.message, '— using MongoDB cache only');
    redis = null;
  }

  return redis;
};

/**
 * Returns the Redis client only when it's in a ready state.
 * Returns null if Redis is unavailable (graceful degradation).
 */
const getRedis = () => {
  if (redis && redis.status === 'ready') return redis;
  return null;
};

module.exports = { connectRedis, getRedis };
