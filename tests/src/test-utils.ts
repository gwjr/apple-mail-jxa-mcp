// tests/src/test-utils.ts - Shared test utilities
//
// Simple assertion functions that work in both Node and JXA environments.

let testCount = 0;
let passCount = 0;
let currentGroup = '';

function group(name: string): void {
  currentGroup = name;
  console.log(`\n=== ${name} ===`);
}

function assert(condition: boolean, message: string): void {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  \u2713 ${message}`);
  } else {
    console.log(`  \u2717 ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  testCount++;
  if (actual === expected) {
    passCount++;
    console.log(`  \u2713 ${message}`);
  } else {
    console.log(`  \u2717 ${message}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  testCount++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passCount++;
    console.log(`  \u2713 ${message}`);
  } else {
    console.log(`  \u2717 ${message}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertOk<T>(result: Result<T>, message: string): T | undefined {
  testCount++;
  if (result.ok) {
    passCount++;
    console.log(`  \u2713 ${message}`);
    return result.value;
  } else {
    console.log(`  \u2717 ${message}`);
    console.log(`      error: ${result.error}`);
    return undefined;
  }
}

function assertError<T>(result: Result<T>, message: string): void {
  testCount++;
  if (!result.ok) {
    passCount++;
    console.log(`  \u2713 ${message}`);
  } else {
    console.log(`  \u2717 ${message}`);
    console.log(`      expected error, got: ${JSON.stringify(result.value)}`);
  }
}

function assertThrows(fn: () => void, message: string): void {
  testCount++;
  try {
    fn();
    console.log(`  \u2717 ${message}`);
    console.log(`      expected exception, but none was thrown`);
  } catch (e) {
    passCount++;
    console.log(`  \u2713 ${message}`);
  }
}

function summary(): { passed: number; total: number; success: boolean } {
  console.log(`\n========================`);
  console.log(`Tests: ${passCount}/${testCount} passed`);
  const success = passCount === testCount;
  if (!success) {
    console.log('SOME TESTS FAILED');
  }
  return { passed: passCount, total: testCount, success };
}

function resetCounters(): void {
  testCount = 0;
  passCount = 0;
  currentGroup = '';
}
