import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PricingCatalogService } from '../services/billing/pricing_catalog_service.js';
import { CountryDetectionService } from '../services/billing/country_detection_service.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { CurrencyCode } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

const GetPlansQuerySchema = z.object({
  currency: z.enum(['INR', 'USD']).optional()
});

const GetPlanParamsSchema = z.object({
  code: z.string().min(1)
});

export async function planRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/plans
   * Public backend-authoritative endpoint returning the currency-aware regional commercial catalog.
   * 
   * INVARIANTS:
   * 1. Resolves storefront currency from detected request headers (IN -> INR, non-IN/unknown -> USD).
   * 2. Sets anti-cache headers (private, no-store, Vary: CF-IPCountry).
   * 3. Prevents client currency manipulation.
   */
  app.get('/plans', async (request: FastifyRequest, reply: FastifyReply) => {
    // Prevent intermediate CDN / proxy cache pollution across regions
    reply.header('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    reply.header('Vary', 'CF-IPCountry, Accept-Encoding');

    try {
      const query = GetPlansQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid currency parameter. Must be INR or USD.'));
      }

      const storefrontPricing = await PricingCatalogService.getStorefrontPricing(
        request.headers,
        query.data.currency
      );

      return reply.send(createSuccessResponse({
        countryCode: storefrontPricing.countryCode,
        currency: storefrontPricing.currency,
        countryConfirmed: storefrontPricing.countryConfirmed,
        plans: storefrontPricing.plans,
        count: storefrontPricing.count,
        timestamp: storefrontPricing.timestamp
      }));
    } catch (error: any) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(createErrorResponse(error.errorCode, error.message));
      }
      request.log.error({ err: error }, 'Failed to fetch plan catalog');
      return reply.status(500).send(createErrorResponse('INTERNAL_SERVER_ERROR', 'Failed to retrieve plan catalog'));
    }
  });

  /**
   * GET /api/v1/plans/:code
   * Public backend-authoritative endpoint returning a single plan by code for the detected region.
   */
  app.get('/plans/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    // Prevent intermediate CDN / proxy cache pollution across regions
    reply.header('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    reply.header('Vary', 'CF-IPCountry, Accept-Encoding');

    try {
      const params = GetPlanParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid plan code parameter.'));
      }

      const query = GetPlansQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid currency parameter. Must be INR or USD.'));
      }

      // Detect storefront region
      const detected = CountryDetectionService.detect(request.headers);
      let targetCurrency = PricingCatalogService.resolveStorefrontCurrency(detected.countryCode);

      if (query.data.currency) {
        if (detected.countrySource === 'CLOUDFLARE' || detected.countrySource === 'DEV_OVERRIDE') {
          if (query.data.currency !== targetCurrency) {
            return reply.status(400).send(
              createErrorResponse('VALIDATION_ERROR', `Requested currency '${query.data.currency}' does not match detected regional storefront '${targetCurrency}'.`)
            );
          }
        } else {
          targetCurrency = query.data.currency as CurrencyCode;
        }
      }

      const plan = await PricingCatalogService.getRegionalPlan(
        params.data.code.toUpperCase(),
        targetCurrency
      );

      if (!plan) {
        return reply.status(404).send(createErrorResponse('PLAN_NOT_FOUND', `Plan with code '${params.data.code}' not found.`));
      }

      return reply.send(createSuccessResponse({
        countryCode: detected.countryCode,
        currency: targetCurrency,
        countryConfirmed: false,
        plan,
        timestamp: new Date().toISOString()
      }));
    } catch (error: any) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(createErrorResponse(error.errorCode, error.message));
      }
      request.log.error({ err: error }, 'Failed to fetch plan details');
      return reply.status(500).send(createErrorResponse('INTERNAL_SERVER_ERROR', 'Failed to retrieve plan details'));
    }
  });
}
