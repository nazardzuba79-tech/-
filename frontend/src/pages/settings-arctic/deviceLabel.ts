// Parses the browser's own User-Agent string down to a short, readable
// "Browser · OS" label — shared by the Security Log table and the Active
// Sessions list, good enough to be scannable without a full UA-parsing
// dependency for this one field.
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  // iPhone/iPad checked before "Mac OS X": every real iOS UA embeds
  // "like Mac OS X" as part of its own platform string (e.g. "CPU iPhone
  // OS 17_0 like Mac OS X"), so checking the desktop-macOS pattern first
  // would misclassify every iPhone/iPad visitor as macOS.
  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}
