import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';

// Allowed IPs and networks
const ALLOWED_IPS = [
  '127.0.0.1',
  '::1',
  'localhost',
  '134.209.98.120', // Allowed external IP
  '94.204.188.210', // Allowed external IP
];

// Local network prefixes (private IP ranges)
const LOCAL_NETWORK_PREFIXES = [
  '10.',        // Class A private
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',   // Class C private
];

function isAllowedIP(ip: string | undefined): boolean {
  if (!ip) return false;

  // Check exact matches
  if (ALLOWED_IPS.includes(ip)) return true;

  // Check local network prefixes
  for (const prefix of LOCAL_NETWORK_PREFIXES) {
    if (ip.startsWith(prefix)) return true;
  }

  // Handle IPv6 localhost variations
  if (ip === '::ffff:127.0.0.1') return true;

  // Handle IPv6-mapped IPv4 addresses
  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.replace('::ffff:', '');
    return isAllowedIP(ipv4);
  }

  return false;
}

function getClientIP(request: Request): string | undefined {
  // Check x-forwarded-for header (common for proxies)
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      .split(',')
      .map(ip => ip.trim());
    return ips[0];
  }

  // Check x-real-ip header
  const realIP = request.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  // Cloudflare
  const cfIP = request.headers['cf-connecting-ip'];
  if (cfIP) {
    return Array.isArray(cfIP) ? cfIP[0] : cfIP;
  }

  // Fallback to socket address
  return request.ip || request.socket?.remoteAddress;
}

@Injectable()
export class IPGuard implements CanActivate {
  private readonly logger = new Logger(IPGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIP = getClientIP(request);
    const path = request.path;

    if (!isAllowedIP(clientIP)) {
      this.logger.warn(`[BLOCKED] Access denied for IP: ${clientIP} to ${path}`);
      throw new ForbiddenException('Access Denied');
    }

    return true;
  }
}
