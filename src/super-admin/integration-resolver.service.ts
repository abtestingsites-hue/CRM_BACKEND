import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface ResolvedIntegrationCredentials {
  provider: string;
  unitId: string | null;
  unitCode?: string | null;
  unitName?: string | null;
  isInherited: boolean;
  enabled: boolean;
  settings: Record<string, any>;
  secret: string | null;
  status: 'CONFIGURED' | 'GLOBAL_DEFAULT' | 'UNIT_OVERRIDE' | 'NOT_CONFIGURED';
}

@Injectable()
export class IntegrationResolverService {
  private readonly logger = new Logger(IntegrationResolverService.name);
  private readonly encryptionKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const secretSeed = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'crmtool-enterprise-integration-key-2026';
    this.encryptionKey = crypto.createHash('sha256').update(secretSeed).digest();
  }

  /**
   * Secure AES-256-GCM Decryption for integration secrets
   */
  decryptSecret(encryptedPayload?: string | null): string | null {
    if (!encryptedPayload) return null;
    try {
      // Check if it's stored in AES-256-GCM format: ivHex:tagHex:encryptedHex
      if (encryptedPayload.includes(':')) {
        const parts = encryptedPayload.split(':');
        if (parts.length === 3) {
          const iv = Buffer.from(parts[0], 'hex');
          const authTag = Buffer.from(parts[1], 'hex');
          const encrypted = parts[2];
          const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        }
      }
      // Backward-compatibility: Base64 fallback
      return Buffer.from(encryptedPayload, 'base64').toString('utf8');
    } catch (err) {
      this.logger.warn(`Failed to decrypt secret payload: ${(err as any).message}`);
      return null;
    }
  }

  /**
   * Secure AES-256-GCM Encryption for integration secrets
   */
  encryptSecret(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Central Resolver:
   * Authenticated User / Context -> Authorized Business Unit -> Integration Provider -> Effective Credentials
   *
   * Priority:
   * 1. Active Unit-Specific Configuration (where unitId = targetUnitId and enabled = true)
   * 2. Global Default (where unitId is null and enabled = true)
   * 3. NOT_CONFIGURED (never cross-pollinate with another unit's credentials)
   */
  async resolveCredentials(
    provider: string,
    unitIdOrCode?: string | null,
    allowGlobalFallback = true
  ): Promise<ResolvedIntegrationCredentials> {
    const upperProvider = provider.toUpperCase();

    let targetUnit: any = null;
    if (unitIdOrCode && unitIdOrCode !== 'ALL' && unitIdOrCode !== 'GLOBAL') {
      targetUnit = await this.prisma.businessUnit.findFirst({
        where: {
          OR: [{ id: unitIdOrCode }, { code: unitIdOrCode }],
        },
      }).catch(() => null);
    }

    // 1. Check for Unit-Specific Override
    if (targetUnit) {
      const unitConfig = await this.prisma.integrationConfiguration.findFirst({
        where: {
          provider: upperProvider,
          unitId: targetUnit.id,
        },
      });

      if (unitConfig && unitConfig.enabled) {
        const decryptedSecret = this.decryptSecret(unitConfig.secretEncrypted);
        return {
          provider: upperProvider,
          unitId: targetUnit.id,
          unitCode: targetUnit.code,
          unitName: targetUnit.name,
          isInherited: false,
          enabled: true,
          settings: (unitConfig.settings && typeof unitConfig.settings === 'object') ? (unitConfig.settings as Record<string, any>) : {},
          secret: decryptedSecret,
          status: 'UNIT_OVERRIDE',
        };
      }
    }

    // 2. Fallback to Global Default if permitted
    if (allowGlobalFallback) {
      const globalConfig = await this.prisma.integrationConfiguration.findFirst({
        where: {
          provider: upperProvider,
          unitId: null,
        },
      });

      if (globalConfig && globalConfig.enabled) {
        const decryptedSecret = this.decryptSecret(globalConfig.secretEncrypted);
        return {
          provider: upperProvider,
          unitId: targetUnit ? targetUnit.id : null,
          unitCode: targetUnit ? targetUnit.code : null,
          unitName: targetUnit ? targetUnit.name : 'Global Platform Default',
          isInherited: Boolean(targetUnit),
          enabled: true,
          settings: (globalConfig.settings && typeof globalConfig.settings === 'object') ? (globalConfig.settings as Record<string, any>) : {},
          secret: decryptedSecret,
          status: 'GLOBAL_DEFAULT',
        };
      }
    }

    // 3. Unconfigured / Disabled
    return {
      provider: upperProvider,
      unitId: targetUnit ? targetUnit.id : null,
      unitCode: targetUnit ? targetUnit.code : null,
      unitName: targetUnit ? targetUnit.name : null,
      isInherited: false,
      enabled: false,
      settings: {},
      secret: null,
      status: 'NOT_CONFIGURED',
    };
  }
}
