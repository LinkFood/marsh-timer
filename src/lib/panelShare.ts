export function generateShareUrl(panelId: string): string {
  return `${window.location.origin}${window.location.pathname}?panel=${panelId}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
