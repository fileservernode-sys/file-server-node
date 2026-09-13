import { PlanService } from '../src/services/billing/plan_service.js';
import { disconnectDatabase } from '../src/config/database.js';

async function main() {
  console.log('🌱 Seeding / verifying authoritative ZdexCloud Plan Catalog...');
  try {
    await PlanService.seedInitialCatalog({
      info: (msg: string) => console.log(`[INFO] ${msg}`),
      warn: (msg: string) => console.warn(`[WARN] ${msg}`)
    });
    console.log('✅ Plan catalog seeded successfully.');
  } catch (err) {
    console.error('❌ Failed to seed plan catalog:', err);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main();

