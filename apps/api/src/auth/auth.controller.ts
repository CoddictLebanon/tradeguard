import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthService, AuthResponse } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { UserRole, User } from '../entities/user.entity';
import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';

interface AuthenticatedRequest extends ExpressRequest {
  user: User;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto.email, dto.password);
  }

  // One-time setup endpoint - only works when no users exist
  @Public()
  @Post('setup')
  async setup(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.setupInitialAdmin(dto.email, dto.password);
  }

  // Check if system needs setup
  @Public()
  @Get('status')
  async status() {
    const hasUsers = await this.authService.hasUsers();
    return { needsSetup: !hasUsers };
  }

  // Only admins can create new users - no public registration for trading system
  @Post('users')
  @Roles(UserRole.ADMIN)
  async createUser(@Body() dto: CreateUserDto): Promise<AuthResponse> {
    return this.authService.register(dto.email, dto.password, dto.name, dto.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: AuthenticatedRequest) {
    return {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }
}
