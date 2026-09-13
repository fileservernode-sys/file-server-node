export type PaymentProviderName = 'RAZORPAY';

export type PaymentProviderStatus = 'ACTIVE' | 'INACTIVE' | 'UNCONFIGURED';

/**
 * Minimal future-ready payment provider interface abstraction.
 * Decouples domain billing state machines from specific gateway API implementations.
 */
export interface IPaymentProvider {
  readonly name: PaymentProviderName;
  isConfigured(): boolean;
  assertConfigured(): void;
}
