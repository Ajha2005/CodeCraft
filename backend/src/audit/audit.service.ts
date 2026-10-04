import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditActorType = 'USER' | 'GUEST' | 'SYSTEM';

export interface AuditEntry {
  /** Dotted name, e.g. "auth.google_link", "territory.transferred", "contest.resolved". */
  action: string;
  actorType?: AuditActorType;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  reason?: string;
  /** Facts about the event. Never put secrets, tokens, emails or code in here. */
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}

/**
 * The record of security-relevant events: who did what to what, and why.
 * A failed write is logged and swallowed, because losing an audit line must
 * never undo or block the action it describes. Bans and flag resolutions will
 * write here too when Phase 6 (anti-cheating) exists.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorType: entry.actorType ?? 'SYSTEM',
          actorId: entry.actorId ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          reason: entry.reason ?? null,
          metadata: entry.metadata ?? undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not write audit entry "${entry.action}": ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
