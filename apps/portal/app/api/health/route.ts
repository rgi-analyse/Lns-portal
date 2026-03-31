export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'lns-dataportal-portal',
    environment: process.env.NODE_ENV ?? 'development',
  });
}
