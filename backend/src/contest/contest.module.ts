import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ContestService } from './contest.service';
import { ContestController } from './contest.controller';
import { ContestGateway } from './contest.gateway';
import { ContestTimeoutProcessor } from './contest-timeout.processor';
import { ProblemsModule } from '../problems/problems.module';
import { TerritoryModule } from '../territory/territory.module';

@Module({
  imports: [
    ProblemsModule,
    TerritoryModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'dev_secret_change_this_in_production',
        ),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') as any,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: 'submissions' },
      { name: 'contest-timeout' },
    ),
  ],
  controllers: [ContestController],
  providers: [ContestService, ContestGateway, ContestTimeoutProcessor],
  exports: [ContestService],
})
export class ContestModule {}
