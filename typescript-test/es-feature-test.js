// ES2020+ Feature Test for JXA's JavaScriptCore
// Run with: osascript -l JavaScript es-feature-test.js

const results = [];

function test(name, fn) {
  try {
    const result = fn();
    results.push(`✓ ${name}: ${JSON.stringify(result)}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
}

// ES6 (2015)
test("arrow functions", () => [1,2,3].map(x => x * 2));
test("template literals", () => `hello ${"world"}`);
test("destructuring", () => { const {a, b} = {a: 1, b: 2}; return [a, b]; });
test("spread operator", () => [...[1,2], ...[3,4]]);
test("classes", () => { class Foo { bar() { return 42; } } return new Foo().bar(); });
test("let/const", () => { let x = 1; const y = 2; return x + y; });
test("default params", () => { const f = (x = 10) => x; return f(); });
test("rest params", () => { const f = (...args) => args.length; return f(1,2,3); });
test("for-of", () => { let s = ""; for (const c of "abc") s += c; return s; });
test("Map", () => { const m = new Map([["a", 1]]); return m.get("a"); });
test("Set", () => { const s = new Set([1,2,2,3]); return s.size; });
test("Symbol", () => { const s = Symbol("test"); return typeof s; });
test("Promise", () => typeof Promise);

// ES2016
test("includes", () => [1,2,3].includes(2));
test("exponentiation", () => 2 ** 10);

// ES2017
test("Object.entries", () => Object.entries({a: 1, b: 2}).length);
test("Object.values", () => Object.values({a: 1, b: 2}));
test("padStart/padEnd", () => "5".padStart(3, "0"));
test("async/await syntax", () => {
  // Just test if it parses - don't actually await
  const f = async () => 42;
  return typeof f;
});

// ES2018
test("rest/spread properties", () => { const {a, ...rest} = {a:1, b:2, c:3}; return rest; });
test("Promise.finally", () => typeof Promise.prototype.finally);

// ES2019
test("Array.flat", () => [[1,2],[3,4]].flat());
test("Array.flatMap", () => [1,2].flatMap(x => [x, x*2]));
test("Object.fromEntries", () => Object.fromEntries([["a", 1], ["b", 2]]));
test("optional catch binding", () => { try { throw 1; } catch { return "caught"; } });
test("trimStart/trimEnd", () => "  hi  ".trimStart().trimEnd());

// ES2020
test("nullish coalescing (??)", () => { const x = null ?? "default"; return x; });
test("optional chaining (?.)", () => { const o = {a: {b: 1}}; return o?.a?.b; });
test("optional chaining missing", () => { const o = {}; return o?.a?.b ?? "missing"; });
test("BigInt", () => { const b = BigInt(9007199254740991); return typeof b; });
test("Promise.allSettled", () => typeof Promise.allSettled);
test("globalThis", () => typeof globalThis);
test("String.matchAll", () => typeof "".matchAll);

// ES2021
test("logical assignment (||=)", () => { let x = null; x ||= 5; return x; });
test("logical assignment (&&=)", () => { let x = 1; x &&= 5; return x; });
test("logical assignment (??=)", () => { let x = null; x ??= 5; return x; });
test("numeric separators", () => 1_000_000);
test("String.replaceAll", () => "aaa".replaceAll("a", "b"));
test("Promise.any", () => typeof Promise.any);

// ES2022
test("Array.at", () => [1,2,3].at(-1));
test("String.at", () => "abc".at(-1));
test("Object.hasOwn", () => Object.hasOwn({a: 1}, "a"));
test("error.cause", () => { const e = new Error("outer", {cause: "inner"}); return e.cause; });
test("top-level await", () => "skipped - would block");

// ES2023
test("Array.findLast", () => [1,2,3,4].findLast(x => x < 3));
test("Array.findLastIndex", () => [1,2,3,4].findLastIndex(x => x < 3));
test("Array.toReversed", () => [1,2,3].toReversed());
test("Array.toSorted", () => [3,1,2].toSorted());
test("Array.toSpliced", () => [1,2,3].toSpliced(1, 1, 99));
test("Array.with", () => [1,2,3].with(1, 99));

// Print results
results.forEach(r => console.log(r));
console.log(`\n${results.filter(r => r.startsWith("✓")).length}/${results.length} tests passed`);
