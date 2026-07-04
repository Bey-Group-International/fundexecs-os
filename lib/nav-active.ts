export function navHrefActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;

  const sessionMatch = pathname.match(/^\/session\/[^/]+\/(.+)$/);
  if (!sessionMatch) return false;

  const sessionTail = `/${sessionMatch[1]}`;
  return sessionTail === href || sessionTail.startsWith(`${href}/`);
}
