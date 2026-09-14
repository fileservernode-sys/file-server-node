const { spawnSync } = require('child_process');
const path = require('path');

const billingTestFiles = [
  'plan_catalog.test.js',
  'entitlement.test.js',
  'billing_state.test.js',
  'country_detection.test.js',
  'currency_pricing.test.js',
  'billing_country.test.js',
  'razorpay_config.test.js',
  'razorpay_plan_sync.test.js',
  'razorpay_reconciliation.test.js',
  'razorpay_checkout.test.js',
  'checkout_price_breakdown.test.js',
  'checkout_security.test.js',
  'pricing_storefront.test.js',
  'payment_success_ux.test.js',
  'webhook_subscription_activation.test.js',
  'renewal_webhook.test.js',
  'dunning_grace_period.test.js',
  'subscription_cancellation.test.js',
  'resubscription_after_cancellation.test.js',
  'subscription_upgrade.test.js',
  'subscription_downgrade.test.js',
  'refund_foundation.test.js',
  'billing_receipt.test.js',
  'tax_and_processing_fee.test.js',
  'billing_reconciliation.test.js'
];

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalCancelled = 0;
let totalSkipped = 0;
let failedSuites = [];
let passedSuites = [];

console.log('====================================================');
console.log('ZDEXCLOUD COMPLETE BILLING TEST SUITE EXECUTION');
console.log('Executing ' + billingTestFiles.length + ' Phase 6 test suites...');
console.log('====================================================\n');

const startTime = Date.now();

for (let i = 0; i < billingTestFiles.length; i++) {
  const file = billingTestFiles[i];
  const filePath = path.join(__dirname, '..', 'dist', 'tests', file);
  process.stdout.write('[' + (i + 1) + '/' + billingTestFiles.length + '] Running ' + file + '... ');

  let attempts = 0;
  let success = false;
  let lastOutput = '';
  let lastStatus = 0;
  let fileTests = 0;
  let filePass = 0;
  let fileFail = 0;
  let fileCancelled = 0;
  let fileSkipped = 0;

  while (attempts < 3 && !success) {
    attempts++;
    const res = spawnSync('node', ['--test', filePath], {
      encoding: 'utf8',
      env: process.env,
      cwd: path.join(__dirname, '..')
    });

    lastOutput = (res.stdout || '') + (res.stderr || '');
    lastStatus = res.status;

    const testsMatch = lastOutput.match(/# tests (\d+)/);
    const passMatch = lastOutput.match(/# pass (\d+)/);
    const failMatch = lastOutput.match(/# fail (\d+)/);
    const cancelledMatch = lastOutput.match(/# cancelled (\d+)/);
    const skippedMatch = lastOutput.match(/# skipped (\d+)/);

    fileTests = testsMatch ? parseInt(testsMatch[1], 10) : 0;
    filePass = passMatch ? parseInt(passMatch[1], 10) : 0;
    fileFail = failMatch ? parseInt(failMatch[1], 10) : 0;
    fileCancelled = cancelledMatch ? parseInt(cancelledMatch[1], 10) : 0;
    fileSkipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

    if (res.status === 0 && fileFail === 0 && fileCancelled === 0 && filePass > 0) {
      success = true;
    } else if (lastOutput.includes('Can\'t reach database server') || lastOutput.includes('Server has closed the connection')) {
      // Transient remote DB disconnect - retry after brief pause
      process.stdout.write('(DB retry ' + attempts + ')... ');
      const waitStart = Date.now();
      while (Date.now() - waitStart < 2000) {}
    } else {
      // Non-network test failure, break
      break;
    }
  }

  totalTests += fileTests;
  totalPassed += filePass;
  totalFailed += fileFail;
  totalCancelled += fileCancelled;
  totalSkipped += fileSkipped;

  if (success) {
    console.log('PASSED (' + filePass + '/' + fileTests + ' tests)');
    passedSuites.push(file);
  } else {
    console.log('FAILED (' + fileFail + ' failed, ' + filePass + ' passed of ' + fileTests + ')');
    failedSuites.push({ file, output: lastOutput.slice(-2000), status: lastStatus });
  }
}

const durationMs = Date.now() - startTime;

console.log('\n====================================================');
console.log('BILLING TEST SUITE SUMMARY');
console.log('====================================================');
console.log('Total Suites: ' + billingTestFiles.length);
console.log('Passed Suites: ' + passedSuites.length);
console.log('Failed Suites: ' + failedSuites.length);
console.log('Total Tests:  ' + totalTests);
console.log('Passed Tests: ' + totalPassed);
console.log('Failed Tests: ' + totalFailed);
console.log('Cancelled:    ' + totalCancelled);
console.log('Skipped:      ' + totalSkipped);
console.log('Duration:     ' + (durationMs / 1000).toFixed(2) + 's');
console.log('Exit Code:    ' + (failedSuites.length === 0 ? 0 : 1));
console.log('====================================================\n');

if (failedSuites.length > 0) {
  console.log('FAILED SUITES DETAILS:');
  failedSuites.forEach(f => {
    console.log('\n--- ' + f.file + ' (status: ' + f.status + ') ---');
    console.log(f.output);
  });
  process.exit(1);
} else {
  console.log('ALL PHASE 6 BILLING TEST SUITES PASSED SUCCESSFULLY!');
  process.exit(0);
}
