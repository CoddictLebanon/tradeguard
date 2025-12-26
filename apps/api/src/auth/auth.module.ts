import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { User } from '../entities/user.entity';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ActivityLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'change-this-secret-in-production'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '24h'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Make JwtAuthGuard global - all routes protected by default
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Make RolesGuard global
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule implements OnModuleInit {
  constructor(private authService: AuthService) {}

  async onModuleInit() {
    // Create initial admin user if none exists
    await this.authService.createInitialAdmin();
  }
}
