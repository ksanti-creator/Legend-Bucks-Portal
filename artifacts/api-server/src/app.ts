import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Trusted origins: Replit dev/prod proxy domains + localhost.
// We do NOT reflect arbitrary origins (origin:true) because credentials:true
// would then allow any site to make authenticated cross-origin requests.
const TRUSTED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[\w-]+\.replit\.dev$/,
  /^https:\/\/[\w-]+\.replit\.app$/,
  /^https:\/\/[\w-]+\.picard\.replit\.dev$/,
  /^https:\/\/[\w-]+\.expo\.picard\.replit\.dev$/,
];

// Allow an explicit APP_URL override (e.g. custom domain in production).
const APP_URL = process.env.APP_URL;
if (APP_URL) {
  try {
    const escaped = APP_URL.replace(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    TRUSTED_ORIGIN_PATTERNS.push(new RegExp(`^${escaped}$`));
  } catch {
    // ignore malformed APP_URL
  }
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no Origin header (curl, server-to-server).
      if (!origin) return callback(null, true);
      const trusted = TRUSTED_ORIGIN_PATTERNS.some((re) => re.test(origin));
      if (trusted) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

export default app;
