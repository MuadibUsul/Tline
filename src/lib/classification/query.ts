import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { isLegacyNonAssetAlias } from "./taxonomy";
import type { ClassifiableContentKind, ContentFilter } from "./types";

const includeFacets = {
  jurisdictions: true,
  institutions: true,
  topics: true,
  assets: { include: { asset: true } },
  assetClasses: true,
  events: true,
} satisfies Prisma.ContentClassificationInclude;

export interface ClassificationQueryOptions {
  contentKinds?: ClassifiableContentKind[];
  take?: number;
  skip?: number;
}

/** Same-facet values use OR (`in`); every populated facet is a separate AND clause. */
export function classificationWhere(filter: ContentFilter): Prisma.ContentClassificationWhereInput {
  const and: Prisma.ContentClassificationWhereInput[] = [];

  if (filter.jurisdictions?.length) {
    and.push({
      jurisdictions: {
        some: {
          jurisdictionKey: { in: filter.jurisdictions },
          ...(filter.primaryJurisdictionOnly ? { role: "PRIMARY" } : {}),
        },
      },
    });
  }
  if (filter.institutions?.length) {
    and.push({ institutions: { some: { institutionKey: { in: filter.institutions } } } });
  }
  if (filter.topics?.length) {
    and.push({ topics: { some: { topicKey: { in: filter.topics } } } });
  }
  if (filter.assets?.length) {
    const tickers = filter.assets.filter((ticker) => !isLegacyNonAssetAlias(ticker));
    and.push({ assets: { some: { asset: { ticker: { in: tickers } } } } });
  }
  if (filter.assetClasses?.length) {
    and.push({ assetClasses: { some: { assetClassKey: { in: filter.assetClasses } } } });
  }
  if (filter.events?.length) {
    and.push({ events: { some: { eventKey: { in: filter.events } } } });
  }
  if (filter.contentTypes?.length) {
    and.push({ contentType: { in: filter.contentTypes } });
  }

  const { from, to } = filter.dateRange ?? {};
  if (from || to) {
    const range: Prisma.DateTimeFilter = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    and.push({
      OR: [
        { article: { publishedAt: range } },
        {
          macroRelease: {
            OR: [
              { releasedAt: range },
              { releasedAt: null, scheduledAt: range },
            ],
          },
        },
        { policyDocument: { publishedAt: range } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

export async function queryClassifications(
  filter: ContentFilter,
  options: ClassificationQueryOptions = {},
) {
  const where = classificationWhere(filter);
  if (options.contentKinds?.length) {
    const existing = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existing, { contentKind: { in: options.contentKinds } }];
  }

  return prisma.contentClassification.findMany({
    where,
    include: includeFacets,
    orderBy: { updatedAt: "desc" },
    skip: Math.max(0, options.skip ?? 0),
    take: Math.min(100, Math.max(1, options.take ?? 50)),
  });
}

/** Article ids for public views; callers keep publication and locale rules at the Article layer. */
export async function queryClassifiedArticleIds(filter: ContentFilter, take = 100): Promise<string[]> {
  const rows = await prisma.article.findMany({
    where: { classification: { is: classificationWhere(filter) } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: Math.min(500, Math.max(1, take)),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
