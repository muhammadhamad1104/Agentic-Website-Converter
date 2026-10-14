import type { CorsOptions } from 'cors';

export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const origins = new Set((env.CORS_ORIGIN || env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map(value => value.trim()).filter(Boolean));

  return {
    origin: (origin, callback) => {
      if (!origin || origins.has(origin)) return callback(null, true);
      if (env.NODE_ENV !== 'production') {
        try {
          const url = new URL(origin);
          if (url.origin === origin && ['http:', 'https:'].includes(url.protocol)
              && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
            return callback(null, true);
          }
        } catch { /* Malformed origins are denied. */ }
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
