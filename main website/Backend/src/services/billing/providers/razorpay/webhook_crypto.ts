import crypto from 'node:crypto';
import { RazorpayProviderError } from './razorpay_error.js';

/**
 * Cryptographically verifies Razorpay Webhook HMAC SHA-256 signature.
 * Uses timingSafeEqual to protect against side-channel timing attacks.
 *
 * @param rawBody - Exact raw UTF-8 string or Buffer of the received request payload
 * @param signature - The signature sent in 'X-Razorpay-Signature' HTTP header
 * @param secret - The configured RAZORPAY_WEBHOOK_SECRET
 * @returns boolean indicating whether the signature is valid
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined | null,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  try {
    const cleanSignature = signature.trim();
    if (!cleanSignature) return false;

    const payloadBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadBuffer)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(cleanSignature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (err: any) {
    return false;
  }
}

/**
 * Asserts valid webhook signature or throws RazorpayProviderError.
 */
export function assertValidRazorpayWebhook(
  rawBody: string | Buffer,
  signature: string | undefined | null,
  secret: string
): void {
  const isValid = verifyRazorpayWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    throw new RazorpayProviderError(
      'INVALID_SIGNATURE',
      'Invalid Razorpay webhook signature. Request may be forged or tampered with.',
      { statusCode: 400 }
    );
  }
}
