import { prisma } from "./db";

interface AuditEvent {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(event: AuditEvent) {
  return prisma.auditLog.create({
    data: {
      actorId: event.actorId ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      metadata: JSON.stringify(event.metadata ?? {}),
    },
  });
}
