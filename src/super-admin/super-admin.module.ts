import { Module, Global } from '@nestjs/common';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';
import { IntegrationResolverService } from './integration-resolver.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, IntegrationResolverService],
  exports: [SuperAdminService, IntegrationResolverService],
})
export class SuperAdminModule {}
