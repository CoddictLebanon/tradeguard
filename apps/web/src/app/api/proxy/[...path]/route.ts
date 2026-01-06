import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3667';

async function proxyRequest(request: NextRequest, path: string[]) {
  try {
    const targetPath = path.join('/');
    const url = new URL(request.url);
    const queryString = url.search;
    const targetUrl = `${API_BASE}/${targetPath}${queryString}`;

    // Forward the authorization header
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Add body for non-GET requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        const body = await request.text();
        if (body) {
          fetchOptions.body = body;
        }
      } catch {
        // No body
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Handle non-JSON responses
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } else {
      const text = await response.text();
      return new NextResponse(text, {
        status: response.status,
        headers: { 'Content-Type': contentType || 'text/plain' }
      });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path);
}
