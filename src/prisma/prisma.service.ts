import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    let dbUrl = process.env.DATABASE_URL;
    const options: any = {
      log: ['warn', 'error'],
    };
    if (dbUrl && dbUrl.includes('pooler.supabase.com') && !dbUrl.includes('pgbouncer=true')) {
      const separator = dbUrl.includes('?') ? '&' : '?';
      dbUrl = `${dbUrl}${separator}pgbouncer=true`;
      options.datasources = { db: { url: dbUrl } };
    }
    super(options);
    (global as any).__prismaInstance = this;
  }

  async onModuleInit() {
    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        this.logger.log('Connected to database successfully.');
        break;
      } catch (err: any) {
        retries--;
        this.logger.warn(`Database connection attempt failed: ${err.message}. Retries remaining: ${retries}`);
        if (retries === 0) {
          throw err;
        }
        await new Promise(res => setTimeout(res, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
