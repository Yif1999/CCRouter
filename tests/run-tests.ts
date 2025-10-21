/* Minimal test runner for CCRouter */
import { runFormatRequestTests } from './formatRequest.test';

async function main() {
  const tests = [
    { name: 'formatRequest image mapping and validations', fn: runFormatRequestTests },
  ];
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`✗ ${t.name}`);
      console.error(err?.stack || err?.message || err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
