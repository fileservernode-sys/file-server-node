const fs = require('fs');
const res = JSON.parse(fs.readFileSync('customer_test_results.json', 'utf8'));

console.log('Total suites:', res.summary.totalSuites);
console.log('Passed suites:', res.summary.suitesPassed);
console.log('Failed suites:', res.summary.suitesFailed);
console.log('Total cases:', res.summary.totalCases);
console.log('Passed cases:', res.summary.casesPassed);
console.log('Failed cases:', res.summary.casesFailed);
console.log('--------------------------------------------------');

for (const r of res.results) {
  const status = r.status.padEnd(8);
  const time = (r.durationMs / 1000).toFixed(1) + 's';
  console.log(`${r.file.padEnd(45)} | ${status} | pass: ${String(r.passed).padStart(3)} | fail: ${String(r.failed).padStart(2)} | ${time}`);
}
