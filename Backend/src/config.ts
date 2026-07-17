import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  CORS_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HAMMY_IN_MEMORY: booleanFromString,
  TRUST_PROXY: booleanFromString,
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseURL?: string;
  jwtSecret: string;
  accessTokenTTLSeconds: number;
  refreshTokenTTLDays: number;
  corsOrigins: string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  inMemory: boolean;
  trustProxy: boolean;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(environment);
  const inMemory = parsed.HAMMY_IN_MEMORY;

  if (parsed.NODE_ENV === "production" && inMemory) {
    throw new Error("HAMMY_IN_MEMORY cannot be enabled in production");
  }
  if (!inMemory && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required unless HAMMY_IN_MEMORY=true");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    ...(parsed.DATABASE_URL ? { databaseURL: parsed.DATABASE_URL } : {}),
    jwtSecret: parsed.JWT_SECRET,
    accessTokenTTLSeconds: parsed.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTLDays: parsed.REFRESH_TOKEN_TTL_DAYS,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean),
    logLevel: parsed.LOG_LEVEL,
    inMemory,
    trustProxy: parsed.TRUST_PROXY,
  };
}
