import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * Remove the operator's own historical analytics rows.
 *
 * The beacon now refuses admin accounts, but rows written before that rule still inflate
 * page views, visitors and page-performance rankings. This is analytics-only history: no
 * article, account or audit row is touched. Run with --apply; the default is a count-only
 * dry run.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const owners = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const admins = await prisma.user.findMany({
    where: { OR: [{ role: { in: ["reviewer", "admin"] } }, ...(owners.length ? [{ email: { in: owners } }] : [])] },
    select: { id: true, email: true },
  });
  const ids = admins.map((user) => user.id);
  const byUser = { userId: { in: ids } };
  const byAdminPath = { path: { startsWith: "/admin" } };

  const counts = {
    pageViews: await prisma.pageView.count({ where: { OR: [byUser, byAdminPath] } }),
    events: await prisma.analyticsEvent.count({ where: { OR: [byUser, byAdminPath] } }),
    clicks: await prisma.clickEvent.count({ where: { OR: [byUser, byAdminPath] } }),
    sections: await prisma.sectionView.count({ where: { OR: [byUser, byAdminPath] } }),
    botHits: await prisma.botHitDaily.count({ where: { path: { startsWith: "/admin" } } }),
  };
  console.log(JSON.stringify({ apply, admins: admins.map((user) => user.email), counts }, null, 2));
  if (!apply) return;
  if (!ids.length) {
    console.log("No admin accounts found; only /admin path rows will be removed.");
  }
  await prisma.$transaction([
    prisma.sectionView.deleteMany({ where: { OR: [byUser, byAdminPath] } }),
    prisma.clickEvent.deleteMany({ where: { OR: [byUser, byAdminPath] } }),
    prisma.analyticsEvent.deleteMany({ where: { OR: [byUser, byAdminPath] } }),
    prisma.pageView.deleteMany({ where: { OR: [byUser, byAdminPath] } }),
    prisma.botHitDaily.deleteMany({ where: { path: { startsWith: "/admin" } } }),
  ]);
  console.log("Internal analytics rows removed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
