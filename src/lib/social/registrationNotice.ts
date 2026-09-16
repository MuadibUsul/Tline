import { prisma } from "../db";
import { sendFeishuText } from "../social/feishu";
import { siteUrl } from "../site";
import { writeAudit } from "../audit";
import { REPORT_ZONE, startOfZoneDay, zoneLabel } from "../zoneTime";

/**
 * Tell the operator when an account appears.
 *
 * Registration is the one moment a new reader exists and nobody is watching: enrolment
 * happens by emailed link or an identity provider, at whatever hour, and the console only
 * shows it later. A short notice to the same group the review cards go to means the desk
 * learns about it while it is still interesting.
 *
 * The notification is best-effort by design: it must never fail a sign-in, so every error
 * is logged and swallowed. Once per creation — the caller fires it from the user-creation
 * event, not from sign-in, so an existing reader signing in never triggers it.
 */
const SOURCE_LABELS: Record<string, string> = {
  email: "邮箱一次性链接",
  google: "Google 登录",
  "azure-ad": "Microsoft Entra ID 登录",
  password: "密码注册",
  oauth: "第三方登录",
};

export interface RegistrationNotice {
  email: string;
  name: string | null;
  source: string;
  createdAt: Date;
  totalUsers: number;
  newToday: number;
  adminUrl: string;
}

export function registrationNoticeText(notice: RegistrationNotice): string {
  return [
    "🆕 Tlines 新用户注册",
    `邮箱：${notice.email}`,
    notice.name ? `姓名：${notice.name}` : null,
    `来源：${SOURCE_LABELS[notice.source] ?? notice.source}`,
    `时间：${zoneLabel(notice.createdAt, REPORT_ZONE)}（北京）`,
    `累计注册：${notice.totalUsers} 人 · 今日新增 ${notice.newToday} 人`,
    `用户管理：${notice.adminUrl}`,
  ].filter(Boolean).join("\n");
}

export async function notifyNewRegistration(user: { email: string; name?: string | null }, source: string, now = new Date()): Promise<void> {
  try {
    const startOfDay = startOfZoneDay(now, REPORT_ZONE);
    const [totalUsers, newToday] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
    ]);
    const notice: RegistrationNotice = {
      email: user.email,
      name: user.name ?? null,
      source,
      createdAt: now,
      totalUsers,
      newToday,
      adminUrl: `${siteUrl()}/zh/admin/users`,
    };
    await sendFeishuText(registrationNoticeText(notice));
    await writeAudit({ action: "auth.user_notified", targetType: "user", metadata: { email: user.email, source, totalUsers } });
  } catch (error) {
    // A missing receiver or a Feishu outage is not a reason for a registration to fail.
    console.error(JSON.stringify({ event: "auth.registration.notice.failed", email: user.email, error: String(error).slice(0, 300) }));
  }
}
