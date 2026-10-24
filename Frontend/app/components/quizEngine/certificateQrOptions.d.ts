import type { Options } from 'qr-code-styling';
export const QR_CODE_KEY: string;
export const QR_PLACEHOLDER_SOURCE: string;
export function parseCertificateQrOptions(key?: string): { options: Options; marginModules: number };
export function isQrCodePlaceholder(value: string): boolean;
