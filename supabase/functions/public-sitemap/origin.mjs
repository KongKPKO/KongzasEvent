export function sitemapOrigin(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname;
  if (hostname === 'kdjqitvtxmcrnnpuxuyl.supabase.co') return 'https://nireqapp--dev-mttk3ru2.web.app';
  if (hostname === 'fnutmjnzugpayccscvgr.supabase.co' || ['localhost', '127.0.0.1', 'kong', 'host.docker.internal'].includes(hostname)) return 'https://paimonq.com';
  throw new Error('Unrecognized sitemap project');
}
