# Plan: Parameterize BaseProtoType<T> for Typed Scalars

## Problem

Currently `baseScalar` and all scalar properties use untyped `any`:
- `resolve(): any` - no type safety on return value
- `withSet(proto)` creates `set(value: any)` - no type safety on mutation
- Schema can't express that `fetchInterval` is a number vs `newMailSound` is a string

## Design

Parameterize `BaseProtoType<T>` and create typed scalar factories.

### 1. Parameterize BaseProtoType

```typescript
interface BaseProtoType<T = any> {
  resolve(): T;
  resolve_eager(): T | Specifier;
  exists(): boolean;
  specifier(): Specifier;
}
```

### 2. Create typed proto types

```typescript
// Scalar proto: BaseProtoType<T> + ScalarBrand for discrimination
type ScalarProto<T> = BaseProtoType<T> & { readonly [ScalarBrand]: T };

// Collection proto: BaseProtoType<Item[]> + CollectionBrand
type CollectionProto<Item> = BaseProtoType<Item[]> & { readonly [CollectionBrand]: Item };
```

### 3. Create scalar factory and primitives

```typescript
const _baseProtoImpl = { resolve(), resolve_eager(), exists(), specifier() };

function scalar<T>(): ScalarProto<T> {
  return { ..._baseProtoImpl } as ScalarProto<T>;
}

const t = {
  string: scalar<string>(),
  number: scalar<number>(),
  boolean: scalar<boolean>(),
  date: scalar<Date>(),
  any: scalar<any>(),
};
```

### 4. Update withSet to propagate type

```typescript
function withSet<T, P extends BaseProtoType<T>>(proto: P): P & { set(value: T): void } {
  return {
    ...proto,
    set(this: { _delegate: Delegate }, value: T) {
      this._delegate.set(value);
    },
  } as P & { set(value: T): void };
}
```

### 5. Update mail.ts to use typed scalars

```typescript
const MailSettingsProto = {
  ...baseScalar,
  fetchInterval: withSet(t.number),      // set(value: number)
  newMailSound: withSet(t.string),       // set(value: string)
  alwaysBccMyself: withSet(t.boolean),   // set(value: boolean)
  // ...
};
```

## Files to Modify

1. **scratch/framework.ts**
   - Parameterize `BaseProtoType<T = any>`
   - Add `ScalarProto<T>`, `CollectionProto<Item>` types
   - Add `scalar<T>()` factory and `t` object
   - Update `withSet` signature to propagate `T`
   - Keep `baseScalar`/`baseCollection` as legacy aliases

2. **scratch/mail.ts**
   - Update all scalar properties to use `t.string`, `t.number`, `t.boolean`
   - Update `withSet(baseScalar)` → `withSet(t.boolean)` etc.

## Verification

```bash
# Type-check
npx tsc scratch/framework.ts scratch/jxa-backing.ts scratch/mail.ts \
  --outFile /dev/null --module None --target ES2020 --lib ES2020 --strict

# Run tests
npx tsc scratch/framework.ts scratch/mock-backing.ts scratch/mail.ts scratch/test-jxaname.ts \
  --outFile scratch/test-jxaname.js --module None --target ES2020 --lib ES2020 --strict
node scratch/test-jxaname.js
```

## Type Safety Result

After implementation:
- `mail.settings.fetchInterval.resolve()` returns `number`
- `mail.settings.fetchInterval.set("wrong")` is a compile-time error
- `mail.settings.fetchInterval.set(5)` compiles correctly
