-- Spending ceilings, enforced automatically before each model call.
--
-- The routing table decides whether a task runs; this decides how much it may spend before
-- it stops on its own. `scope` is either the sentinel '*' (every task, summed) or one
-- LlmTask. Empty until an operator sets a ceiling, so this migration changes no behaviour on
-- its own. A token cap is always enforceable; a cost cap only bites once the models in play
-- are priced. Enforcement fails open, so an unreachable table cannot halt the pipeline.

CREATE TABLE "LlmBudget" (
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'month',
    "limitTokens" INTEGER,
    "limitCost" DOUBLE PRECISION,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmBudget_pkey" PRIMARY KEY ("scope")
);
