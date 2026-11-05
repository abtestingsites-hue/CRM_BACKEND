import * as crypto from 'crypto';
import {
  Controller,
  Post,
  Get,
  Req,
  Body,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  Inject,
  Optional,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../api-gateway/auth.guard';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';

@Controller('api/v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redisClient?: any,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body;
    this.logger.log(`Attempting login for email: ${email}`);

    try {
      if (!email || !password) {
        throw new UnauthorizedException('Email and password are required');
      }

      const user = await this.prisma.user.findUnique({
        where: { email },
        include: { agentProfile: true, role: true },
      });

      if (!user) {
        this.logger.warn(`User not found: ${email}`);
        throw new UnauthorizedException('Invalid email or password');
      }

      if (!user.passwordHash) {
        this.logger.warn(`User has no password hash configured: ${email}`);
        throw new UnauthorizedException('Invalid email or password');
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        this.logger.warn(`Invalid password for user: ${email}`);
        throw new UnauthorizedException('Invalid email or password');
      }

      const resolvedRole = user.role?.name || user.crmRole || 'AGENT';

      const payload = {
        sub: user.id,
        userId: user.id,
        agentId: user.agentProfile?.id || user.id,
        email: user.email,
        role: resolvedRole,
        name: user.agentProfile?.name || 'Admin',
        department: user.agentProfile?.department || 'General Support',
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
      
      this.logger.log(`Login successful for user: ${email}`);
      return {
        accessToken,
        refreshToken,
        session: {
          id: user.id,
          userId: user.id,
          agentId: user.agentProfile?.id || user.id,
          email: user.email,
          role: resolvedRole,
          name: user.agentProfile?.name || 'Admin',
          department: user.agentProfile?.department || 'General Support',
        },
      };
    } catch (error) {
      this.logger.error(`Login error: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to process login');
    }
  }

  @Get('me')
  async getProfile(@Req() req: any) {
    if (!req.user) {
      throw new UnauthorizedException('Not authenticated');
    }
    const userId = req.user.userId || req.user.sub || req.user.id;
    let user: any = null;
    if (userId) {
      try {
        user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: { agentProfile: true, role: true },
        });
      } catch (_) {}
    }

    const resolvedRole = user?.role?.name || user?.crmRole || req.user.role || 'AGENT';

    return {
      userId: user ? user.id : userId,
      id: user ? user.id : userId,
      email: user ? user.email : (req.user.email || ''),
      role: resolvedRole,
      name: user?.agentProfile?.name || req.user.name || 'User',
      department: user?.agentProfile?.department || req.user.department || 'General',
      agentId: user?.agentProfile?.id || req.user.agentId,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Req() req: any) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : authHeader;

    if (token && this.redisClient) {
      try {
        await this.redisClient.set(`revoked_token:${token}`, '1', 'EX', 7 * 86400);
      } catch (err: any) {
        this.logger.error(`Failed to blacklist token in redis: ${err.message}`);
      }
    }
    return { success: true, message: 'Logged out successfully' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  async refresh(@Body() body: any) {
    const { refreshToken } = body;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    if (this.redisClient) {
      try {
        const isRevoked = await this.redisClient.get(`revoked_token:${refreshToken}`);
        if (isRevoked) {
          throw new UnauthorizedException('Refresh token has been revoked');
        }
      } catch (e) {
        // Continue if redis is unavailable
      }
    }

    try {
      const secret = process.env.JWT_SECRET || 'crm-secure-jwt-secret-key-2026';
      const payload = await this.jwtService.verifyAsync(refreshToken, { secret });

      const newPayload = {
        sub: payload.sub,
        userId: payload.userId,
        agentId: payload.agentId,
        email: payload.email,
        role: payload.role,
        name: payload.name,
        department: payload.department,
      };

      const newAccessToken = this.jwtService.sign(newPayload, { expiresIn: '8h' });
      const newRefreshToken = this.jwtService.sign(newPayload, { expiresIn: '7d' });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  async resetPassword(@Body() body: any) {
    const { email, token, newPassword } = body;

    // Phase 1: Request password reset link / token
    if (email && !token) {
      // Safe response: Always return success message without revealing account existence
      return {
        success: true,
        message: 'If an account with that email exists, password reset instructions have been sent.',
      };
    }

    // Phase 2: Perform password reset with token
    if (token && newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        throw new UnauthorizedException('Password must be at least 8 characters long');
      }
      try {
        const secret = process.env.JWT_SECRET || 'crm-secure-jwt-secret-key-2026';
        const decoded = await this.jwtService.verifyAsync(token, { secret });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await this.prisma.user.update({
          where: { id: decoded.sub || decoded.userId },
          data: { passwordHash: hashedPassword },
        });
        return {
          success: true,
          message: 'Password has been successfully updated.',
        };
      } catch (err) {
        throw new UnauthorizedException('Invalid or expired reset token');
      }
    }

    throw new UnauthorizedException('Invalid reset request');
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sso-exchange')
  async ssoExchange(@Body() body: any) {
    const { ticket } = body;
    if (!ticket || typeof ticket !== 'string' || !ticket.startsWith('sso_') || ticket.length < 60) {
      throw new UnauthorizedException('Invalid or missing SSO exchange ticket');
    }

    if (!this.redisClient) {
      throw new InternalServerErrorException('SSO verification cache unavailable');
    }

    // 1. Compute SHA-256 hash of the presented ticket to match storage key
    const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
    const redisKey = 'sso_ticket_hash:' + ticketHash;

    // 2. Atomic GETDEL: Retrieves and permanently deletes the ticket in a single operation
    // Eliminates race conditions and simultaneous concurrent replay attempts
    let cachedData: string | null = null;
    try {
      cachedData = await this.redisClient.getdel(redisKey);
    } catch {
      // Fallback for Redis servers without GETDEL
      cachedData = await this.redisClient.get(redisKey);
      if (cachedData) await this.redisClient.del(redisKey);
    }

    if (!cachedData) {
      this.logger.warn('SSO ticket rejected: ticket expired, already redeemed, or invalid');
      throw new UnauthorizedException('SSO ticket expired or already redeemed');
    }

    let parsedTicket: any;
    try {
      parsedTicket = JSON.parse(cachedData);
    } catch {
      throw new UnauthorizedException('Corrupted SSO ticket payload');
    }

    // 3. Verify Audience and Issuer
    if (parsedTicket.audience !== 'CRM_SUITE' || parsedTicket.issuer !== 'ERP_SUPERADMIN_AUTH') {
      this.logger.error('SSO ticket rejected: Invalid audience or issuer ' + JSON.stringify(parsedTicket));
      throw new UnauthorizedException('Untrusted SSO ticket audience or issuer');
    }

    // 4. Verify User Identity and Account Status in Canonical Database
    const user = await this.prisma.user.findUnique({
      where: { id: parsedTicket.userId },
      include: { agentProfile: true, role: true },
    });

    if (!user || user.isDeleted || !user.isActive) {
      throw new UnauthorizedException('User account inactive, suspended or not found');
    }

    // 5. Strict Role Verification: Enforce that only verified Super Admin gets SUPER_ADMIN
    const isSuperAdmin = user.role?.name === 'Super Admin' || user.crmRole === 'SUPER_ADMIN';
    if (!isSuperAdmin) {
      this.logger.error('SSO elevation rejected: User ' + user.email + ' is not an authorized Super Admin');
      throw new UnauthorizedException('Unauthorized account elevation attempt');
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const payload = {
      sub: user.id,
      userId: user.id,
      agentId: user.agentProfile?.id || user.id,
      email: user.email,
      role: 'SUPER_ADMIN',
      tenantId: user.tenantId,
      unitId: user.unitId,
      aud: 'CRM_SUITE',
      iss: 'CRM_AUTH_GATEWAY',
      name: user.agentProfile?.name || fullName || 'Super Administrator',
      department: user.agentProfile?.department || 'Administration',
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    // 6. Record Audit Log in canonical AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        module: 'AUTH',
        action: 'SSO_EXCHANGE_SUCCESS',
        tenantId: user.tenantId || 'DEFAULT',
        unitId: user.unitId || 'DEFAULT',
        payload: {
          email: user.email,
          role: 'SUPER_ADMIN',
          audience: 'CRM_SUITE',
          timestamp: new Date().toISOString()
        }
      }
    }).catch((e: any) => this.logger.warn('Failed to record SSO AuditLog: ' + e.message));

    this.logger.log('SSO exchange successfully certified for user: ' + user.email + ' (Role: SUPER_ADMIN)');

    return {
      accessToken,
      refreshToken,
      session: {
        id: user.id,
        userId: user.id,
        agentId: user.agentProfile?.id || user.id,
        email: user.email,
        role: 'SUPER_ADMIN',
        tenantId: user.tenantId,
        unitId: user.unitId,
        name: payload.name,
        department: payload.department,
      },
    };
  }
}
