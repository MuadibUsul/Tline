-- Unified faceted classification. Article.institutionId remains the publisher relation;
-- subject institutions live in ClassificationInstitution.
CREATE TABLE "ContentClassification" (
    "id" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "articleId" TEXT,
    "macroIndicatorId" TEXT,
    "macroReleaseId" TEXT,
    "policyDocumentId" TEXT,
    "jurisdictionState" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "taxonomyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentClassification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentClassification_target_check" CHECK (
        ("contentKind" = 'ARTICLE' AND "articleId" IS NOT NULL AND "macroIndicatorId" IS NULL AND "macroReleaseId" IS NULL AND "policyDocumentId" IS NULL) OR
        ("contentKind" = 'MACRO_INDICATOR' AND "articleId" IS NULL AND "macroIndicatorId" IS NOT NULL AND "macroReleaseId" IS NULL AND "policyDocumentId" IS NULL) OR
        ("contentKind" = 'MACRO_RELEASE' AND "articleId" IS NULL AND "macroIndicatorId" IS NULL AND "macroReleaseId" IS NOT NULL AND "policyDocumentId" IS NULL) OR
        ("contentKind" = 'POLICY_DOCUMENT' AND "articleId" IS NULL AND "macroIndicatorId" IS NULL AND "macroReleaseId" IS NULL AND "policyDocumentId" IS NOT NULL)
    )
);

CREATE TABLE "ClassificationJurisdiction" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "jurisdictionKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ClassificationJurisdiction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassificationInstitution" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "institutionKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "ClassificationInstitution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassificationTopic" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ClassificationTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassificationAsset" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ClassificationAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassificationAssetClass" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "assetClassKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ClassificationAssetClass_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassificationEvent" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ClassificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentClassification_articleId_key" ON "ContentClassification"("articleId");
CREATE UNIQUE INDEX "ContentClassification_macroIndicatorId_key" ON "ContentClassification"("macroIndicatorId");
CREATE UNIQUE INDEX "ContentClassification_macroReleaseId_key" ON "ContentClassification"("macroReleaseId");
CREATE UNIQUE INDEX "ContentClassification_policyDocumentId_key" ON "ContentClassification"("policyDocumentId");
CREATE INDEX "ContentClassification_contentKind_idx" ON "ContentClassification"("contentKind");
CREATE INDEX "ContentClassification_jurisdictionState_idx" ON "ContentClassification"("jurisdictionState");
CREATE INDEX "ContentClassification_contentType_idx" ON "ContentClassification"("contentType");
CREATE INDEX "ContentClassification_source_idx" ON "ContentClassification"("source");

CREATE UNIQUE INDEX "ClassificationJurisdiction_classificationId_jurisdictionKey_key"
    ON "ClassificationJurisdiction"("classificationId", "jurisdictionKey");
CREATE INDEX "ClassificationJurisdiction_jurisdictionKey_role_idx"
    ON "ClassificationJurisdiction"("jurisdictionKey", "role");

CREATE UNIQUE INDEX "ClassificationInstitution_classificationId_institutionKey_key"
    ON "ClassificationInstitution"("classificationId", "institutionKey");
CREATE INDEX "ClassificationInstitution_institutionKey_role_idx"
    ON "ClassificationInstitution"("institutionKey", "role");

CREATE UNIQUE INDEX "ClassificationTopic_classificationId_topicKey_key"
    ON "ClassificationTopic"("classificationId", "topicKey");
CREATE INDEX "ClassificationTopic_topicKey_idx" ON "ClassificationTopic"("topicKey");

CREATE UNIQUE INDEX "ClassificationAsset_classificationId_assetId_key"
    ON "ClassificationAsset"("classificationId", "assetId");
CREATE INDEX "ClassificationAsset_assetId_idx" ON "ClassificationAsset"("assetId");

CREATE UNIQUE INDEX "ClassificationAssetClass_classificationId_assetClassKey_key"
    ON "ClassificationAssetClass"("classificationId", "assetClassKey");
CREATE INDEX "ClassificationAssetClass_assetClassKey_idx"
    ON "ClassificationAssetClass"("assetClassKey");

CREATE UNIQUE INDEX "ClassificationEvent_classificationId_eventKey_key"
    ON "ClassificationEvent"("classificationId", "eventKey");
CREATE INDEX "ClassificationEvent_eventKey_idx" ON "ClassificationEvent"("eventKey");

ALTER TABLE "ContentClassification" ADD CONSTRAINT "ContentClassification_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentClassification" ADD CONSTRAINT "ContentClassification_macroIndicatorId_fkey"
    FOREIGN KEY ("macroIndicatorId") REFERENCES "MacroIndicator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentClassification" ADD CONSTRAINT "ContentClassification_macroReleaseId_fkey"
    FOREIGN KEY ("macroReleaseId") REFERENCES "MacroRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentClassification" ADD CONSTRAINT "ContentClassification_policyDocumentId_fkey"
    FOREIGN KEY ("policyDocumentId") REFERENCES "MacroPolicyDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationJurisdiction" ADD CONSTRAINT "ClassificationJurisdiction_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationInstitution" ADD CONSTRAINT "ClassificationInstitution_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationTopic" ADD CONSTRAINT "ClassificationTopic_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationAsset" ADD CONSTRAINT "ClassificationAsset_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationAsset" ADD CONSTRAINT "ClassificationAsset_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassificationAssetClass" ADD CONSTRAINT "ClassificationAssetClass_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassificationEvent" ADD CONSTRAINT "ClassificationEvent_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
