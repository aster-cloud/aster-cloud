import { NextResponse } from 'next/server';

/**
 * POST /api/csp-report
 * 接收浏览器上报的 CSP 违规事件
 *
 * 配合 next.config.ts 中的 Content-Security-Policy report-uri 指令使用。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // CSP 违规报告格式：https://www.w3.org/TR/CSP3/#violation-events
    const report = body['csp-report'] || body;

    console.warn('[CSP Violation]', JSON.stringify({
      blockedUri: report['blocked-uri'],
      documentUri: report['document-uri'],
      violatedDirective: report['violated-directive'],
      effectiveDirective: report['effective-directive'],
      originalPolicy: report['original-policy']?.substring(0, 200),
      disposition: report.disposition,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json({ received: true }, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
  }
}
