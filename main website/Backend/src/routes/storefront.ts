import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CountryDetectionService } from '../services/billing/country_detection_service.js';
import { createSuccessResponse } from '../schemas/response.js';

export async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/storefront/region
   * Public, non-authoritative storefront geolocation hint endpoint.
   * 
   * INVARIANTS:
   * 1. Accessible by anonymous visitors and authenticated users alike.
   * 2. Returns initial display currency (IN -> INR, other/unknown -> USD).
   * 3. Sets strict anti-caching headers so CDNs never cross-serve country responses.
   * 4. Does NOT mutate AccountBillingState.billingCountry or any customer profiles.
   */
  app.get('/storefront/region', async (request: FastifyRequest, reply: FastifyReply) => {
    // Prevent intermediate proxy / CDN caching across diverse geo locations
    reply.header('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    reply.header('Vary', 'CF-IPCountry, Accept-Encoding');

    const detected = CountryDetectionService.detect(request.headers);

    request.log.debug(
      { countryCode: detected.countryCode, source: detected.countrySource, currency: detected.currency },
      'Storefront region evaluated'
    );

    return reply.send(createSuccessResponse({
      countryCode: detected.countryCode,
      countrySource: detected.countrySource,
      currency: detected.currency,
      countryConfirmed: detected.countryConfirmed
    }));
  });
}
