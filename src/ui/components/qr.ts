import QRCode from 'qrcode';

/**
 * Generate an inline SVG string for any URL / string with high contrast
 * and optional custom dimensions.
 */
export async function generateQrSvg(
  text: string,
  options?: { width?: number; margin?: number; darkColor?: string; lightColor?: string },
): Promise<string> {
  const width = options?.width ?? 180;
  const margin = options?.margin ?? 1;
  const dark = options?.darkColor ?? '#05070A';
  const light = options?.lightColor ?? '#FFFFFF';

  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      width,
      margin,
      color: {
        dark,
        light,
      },
      errorCorrectionLevel: 'M',
    });
    return svg;
  } catch {
    // Graceful fallback SVG box with error indicator
    return `
      <svg width="${width}" height="${width}" viewBox="0 0 ${width} ${width}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${width}" fill="${light}" rx="8"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#D21034" font-size="12" font-family="sans-serif">QR Error</text>
      </svg>
    `;
  }
}
