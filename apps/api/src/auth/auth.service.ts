import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../entities/user.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
    private jwtService: JwtService,
  ) {}

  async register(
    email: string,
    password: string,
    name?: string,
    role: UserRole = UserRole.VIEWER,
  ): Promise<AuthResponse> {
    // Check if user exists
    const existingUser = await this.userRepo.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = this.userRepo.create({
      email,
      passwordHash,
      name,
      role,
    });

    await this.userRepo.save(user);

    await this.activityRepo.save({
      type: ActivityType.SYSTEM,
      message: `User registered: ${email}`,
      details: { userId: user.id, role },
    });

    this.logger.log(`User registered: ${email}`);

    return this.generateToken(user);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.userRepo.findOne({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    await this.activityRepo.save({
      type: ActivityType.SYSTEM,
      message: `User logged in: ${email}`,
      details: { userId: user.id },
    });

    this.logger.log(`User logged in: ${email}`);

    return this.generateToken(user);
  }

  async validateUser(payload: JwtPayload): Promise<User | null> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub, isActive: true },
    });
    return user;
  }

  private generateToken(user: User): AuthResponse {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.save(user);

    this.logger.log(`Password changed for user: ${user.email}`);
  }

  async createInitialAdmin(): Promise<void> {
    const adminCount = await this.userRepo.count({ where: { role: UserRole.ADMIN } });
    if (adminCount === 0) {
      // Create default admin if none exists
      const defaultPassword = process.env.ADMIN_PASSWORD || 'changeme123!';
      await this.register('admin@tradeguard.local', defaultPassword, 'Admin', UserRole.ADMIN);
      this.logger.warn('Created default admin user - CHANGE THE PASSWORD IMMEDIATELY');
    }
  }
}
