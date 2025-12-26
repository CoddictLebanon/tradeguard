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
import { AuthService, AuthResponse } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';
import { IsEmail, IsString, MinLength } from 'class-validator';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class RegisterDto extends LoginDto {
  @IsString()
  name?: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
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

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto.email, dto.password, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
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
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }
}
