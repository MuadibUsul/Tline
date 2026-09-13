import { prisma } from "../db";
import { licensePermits, type MarketDataUse } from "./market/quality";

export interface ExpectationLicenseRef { id: string; licenseKey: string | null }

/** Returns only expectation evidence whose licence explicitly permits this output surface. */
export async function authorizedExpectationIds(expectations: ExpectationLicenseRef[], use: MarketDataUse, now = new Date()) {
  const keys = [...new Set(expectations.map((item) => item.licenseKey).filter((key): key is string => Boolean(key)))];
  const policies = await prisma.dataLicensePolicy.findMany({ where: { datasetKey: { in: keys } } });
  const byKey = new Map(policies.map((policy) => [policy.datasetKey, policy]));
  return new Set(expectations.filter((item) => item.licenseKey && licensePermits(byKey.get(item.licenseKey) ?? null, use, now)).map((item) => item.id));
}
