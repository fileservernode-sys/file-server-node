const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = path.join(__dirname, '..', 'dist', 'tests');
const allFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).sort();
const customerFiles = allFiles.filter(f => !f.startsWith('admin_'));

console.log(`=== EXECUTING CUSTOMER-FACING & CUSTOMER-RELATED TEST SUITES (${customerFiles.length} Test Files) ===\n`);

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
let totalSuitesPassed = 0;
let totalSuitesFailed = 0;
const startTime = Date.now();

for (let i = 0; i < customerFiles.length; i++) {
  const file = customerFiles[i];
  const filePath = path.join(testsDir, file);
  const testStart = Date.now();
  
  const res = spawnSync(process.execPath, ['--test', filePath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 120000
  });
  
  const duration = Date.now() - testStart;
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const fullOutput = stdout + '\n' + stderr;
  
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  
  const passMatch = stdout.match(/# pass (\d+)/);
  const failMatch = stdout.match(/# fail (\d+)/);
  const skipMatch = stdout.match(/# (?:cancelled|skipped|todo) (\d+)/);
  
  if (passMatch) passCount = parseInt(passMatch[1], 10);
  if (failMatch) failCount = parseInt(failMatch[1], 10);
  if (skipMatch) skipCount = parseInt(skipMatch[1], 10);
  
  if (!passMatch && !failMatch) {
    const okMatches = stdout.match(/^ok /gm);
    const notOkMatches = stdout.match(/^not ok /gm);
    if (okMatches) passCount = okMatches.length;
    if (notOkMatches) failCount = notOkMatches.length;
  }
  
  const suitePassed = (res.status === 0 && failCount === 0);
  if (suitePassed) {
    totalSuitesPassed++;
    console.log(`[${i + 1}/${customerFiles.length}] PASS: ${file} (${duration}ms) - tests: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  } else {
    totalSuitesFailed++;
    console.log(`[${i + 1}/${customerFiles.length}] FAIL: ${file} (Exit code: ${res.status}, ${duration}ms) - tests: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
    console.log(`--- Output excerpt ---`);
    console.log(fullOutput.slice(-1500));
    console.log(`----------------------`);
  }
  
  totalPassed += passCount;
  totalFailed += failCount;
  totalSkipped += skipCount;
  
  results.push({
    file,
    status: suitePassed ? 'PASSED' : 'FAILED',
    exitCode: res.status,
    durationMs: duration,
    passed: passCount,
    failed: failCount,
    skipped: skipCount,
    error: suitePassed ? null : fullOutput
  });
}

const totalDuration = Date.now() - startTime;

console.log('\n============================================================');
console.log('SUMMARY OF CUSTOMER-FACING TEST EXECUTION:');
console.log(`Total Test Files (Suites):   ${customerFiles.length}`);
console.log(`Suites Passed:               ${totalSuitesPassed}`);
console.log(`Suites Failed:               ${totalSuitesFailed}`);
console.log(`Total Test Assertions/Cases: ${totalPassed + totalFailed + totalSkipped}`);
console.log(`Cases Passed:                ${totalPassed}`);
console.log(`Cases Failed:                ${totalFailed}`);
console.log(`Cases Skipped:               ${totalSkipped}`);
console.log(`Total Execution Time:        ${(totalDuration / 1000).toFixed(2)}s`);
console.log('============================================================\n');

fs.writeFileSync(
  path.join(__dirname, '..', 'customer_test_results.json'),
  JSON.stringify({
    timestamp: new Date().toISOString(),
    totalDurationMs: totalDuration,
    summary: {
      totalSuites: customerFiles.length,
      suitesPassed: totalSuitesPassed,
      suitesFailed: totalSuitesFailed,
      totalCases: totalPassed + totalFailed + totalSkipped,
      casesPassed: totalPassed,
      casesFailed: totalFailed,
      casesSkipped: totalSkipped
    },
    results
  }, null, 2)
);
