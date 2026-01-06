import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Allowed IPs and networks
const ALLOWED_IPS = [
  '127.0.0.1',
  '::1',
  'localhost',
  '134.209.98.120', // Allowed external IP
];

// Local network prefixes (private IP ranges)
const LOCAL_NETWORK_PREFIXES = [
  '10.',        // Class A private
  '172.16.',    // Class B private (172.16.0.0 - 172.31.255.255)
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',   // Class C private
];

function isAllowedIP(ip: string | null): boolean {
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

function getClientIP(request: NextRequest): string | null {
  // Check various headers for the real IP (in case of proxies)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  // Fallback to connection IP (Next.js doesn't expose this directly in middleware)
  // The IP will be in x-forwarded-for if behind a proxy, otherwise we check headers
  const cfConnectingIP = request.headers.get('cf-connecting-ip'); // Cloudflare
  if (cfConnectingIP) return cfConnectingIP;

  // For local development, assume localhost if no headers
  return '127.0.0.1';
}

export function middleware(request: NextRequest) {
  const clientIP = getClientIP(request);
  const pathname = request.nextUrl.pathname;

  // Always allow robots.txt (so bots know not to index)
  if (pathname === '/robots.txt') {
    return NextResponse.next();
  }

  // Check if IP is allowed
  if (!isAllowedIP(clientIP)) {
    // Log blocked attempt
    console.log(`[BLOCKED] Access denied for IP: ${clientIP} to ${pathname}`);

    // Return 403 Forbidden
    return new NextResponse('Access Denied', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  // Add security headers to response
  const response = NextResponse.next();

  // Prevent indexing
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

  // Additional security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');

  return response;
}

// Apply middleware to all routes
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
