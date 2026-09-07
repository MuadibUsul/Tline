-- Model-provider configuration, task routing, prices and per-call usage.
--
-- Credentials moved out of the environment so they can be changed from the console without
-- a redeploy. The environment is still read as the fallback, so this migration changes no
-- behaviour on its own: nothing here is populated until an operator saves something.
--
-- LlmCall exists because every provider returns token counts on the response and the
-- pipeline was discarding all of them, leaving character-count estimates as the only way to
-- answer what a run cost.

CREATE TABLE "LlmProvider" (
    "provider" TEXT NOT NULL,
    "apiKeyCipher" TEXT,
    "apiKeyHint" TEXT,
    "baseUrl" TEXT,
    "defaultModel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "LlmTaskRoute" (
    "task" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmTaskRoute_pkey" PRIMARY KEY ("task")
);

CREATE TABLE "LlmModelPrice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerMTok" DOUBLE PRECISION NOT NULL,
    "outputPerMTok" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModelPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    -- UTC day as a stored string: date extraction differs between SQLite and PostgreSQL,
    -- and a per-row date function cannot use an index in either.
    "day" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    -- Why the model stopped, normalised across vendors: "stop", "length", "filter".
    -- Truncation is invisible in the token counts and is usually why a caller retries.
    "finishReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LlmModelPrice_provider_model_key" ON "LlmModelPrice"("provider", "model");
CREATE INDEX "LlmCall_day_idx" ON "LlmCall"("day");
CREATE INDEX "LlmCall_day_task_idx" ON "LlmCall"("day", "task");
CREATE INDEX "LlmCall_day_provider_model_idx" ON "LlmCall"("day", "provider", "model");
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");
