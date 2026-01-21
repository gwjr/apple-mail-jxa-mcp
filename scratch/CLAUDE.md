# Plugboard v4

A typed resource abstraction for macOS app scripting via JXA.

## Goal

Create a framework where:
1. It is simple and ergonomic to define a schema reflecting an app's scripting dictionary
2. App schemas (Mail, Notes, etc.) are plain TypeScript objects, but as strongly typed as possible
3. URIs like `mail://accounts/Exchange/mailboxes/INBOX` resolve to typed resources
4. The same schema works with JXA (osascript) or mock data (Node.js tests)

## Architecture

```
framework.ts    Core types, protos, composers, URI parsing (app-agnostic)
jxa-backing.ts  JXADelegate - talks to real apps via osascript
mock-backing.ts MockDelegate - works against in-memory data for testing
mail.ts         Mail.app schema (uses framework building blocks)
notes.ts        Notes.app schema (uses framework building blocks)
```

## Design Rules

1. **Use the type system** - Faced with a choice between easy and type gymnastics, be the gymnast
2. **No magic strings** - No `kind: 'scalar'`, no switch statements on string literals
3. **Brands are compile-time only** - `declare const X: unique symbol`, never instantiated
4. **Prototypes are plain objects** - Nothing to inspect at runtime
5. **Composition via spread** - `makeLazy(proto)` spreads and overrides
6. **Closures, not properties** - `itemProto` closed over, not stored as `_itemProto`
7. **Clean side vs dirty side** - Typed domain code; `any` (preferably, `unknown`) only at JXA/mock boundary
8. **Schema IS the prototype (DRY)** - Define proto objects directly; derive types with `typeof`. Never duplicate a proto as both interface and const.

### Proto Definition Pattern

**WRONG** - duplicates structure in interface and const:
```typescript
interface FooProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  count: typeof eagerScalar;
}
const FooProto: FooProtoType = {
  ...baseScalar,
  name: eagerScalar,
  count: eagerScalar,
};
```

**RIGHT** - define once, derive type:
```typescript
const FooProto = {
  ...baseScalar,
  name: eagerScalar,
  count: eagerScalar,
};
type Foo = Res<typeof FooProto>;
```

**EXCEPTION** - recursive types need an interface for self-reference:
```typescript
interface MailboxProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  mailboxes: BaseProtoType & ByIndexProto<MailboxProtoType>;  // Self-reference
}
const MailboxProto: MailboxProtoType = { ... };
```

## Key Abstractions

### Delegate (the abstraction boundary)

```typescript
interface Delegate {
  _jxa(): any;                    // Returns data (name is historical)
  prop(key: string): Delegate;
  propWithAlias(jxaName: string, uriName: string): Delegate;
  byIndex(n: number): Delegate;
  byName(name: string): Delegate;
  byId(id: string | number): Delegate;
  uri(): string;
  set(value: any): void;
  namespace(name: string): Delegate;  // Virtual grouping (no JXA navigation)
  withFilter(filter: WhoseFilter): Delegate;
  withSort(sort: SortSpec<any>): Delegate;
  withPagination(pagination: PaginationSpec): Delegate;
  withExpand(fields: string[]): Delegate;
  queryState(): QueryState;
}
```

Everything above Delegate (protos, composers, createRes) is JXA-agnostic. Only JXADelegate/MockDelegate know about their backing.

### Res (runtime wrapper)

```typescript
type Res<P> = P & { _delegate: Delegate };
```

A Proxy that wires proto methods to the delegate. Access `res.name` and it creates a child Res with `delegate.prop('name')`.

### Proto Composition

```typescript
// Base protos
const baseScalar = { resolve(), exists(), specifier() }
const baseCollection = { resolve(), exists(), specifier() }

// Composers add behavior
makeLazy(proto)           // resolve_eager returns specifier
withSet(proto)            // adds set() method
withByIndex(itemProto)    // adds byIndex() accessor
withByName(itemProto)     // adds byName() accessor
withById(itemProto)       // adds byId() accessor
withQuery(proto)          // adds whose(), sortBy(), paginate()
withJxaName(proto, name)  // maps schema name to different JXA name
computedNav(fn, proto)    // complex navigation (e.g., account.inbox → mailboxes.byName('INBOX'))
namespaceNav(proto)       // virtual grouping (no JXA navigation, adds URI segment)
computed(transform)       // transforms raw value (e.g., parse email string)

// Composition via pipe
const messages = pipe2(baseCollection, withByIndex(MessageProto), withById(MessageProto))
```

### App Schema Example

```typescript
const MailboxProto = {
  ...baseScalar,
  name: eagerScalar,
  unreadCount: eagerScalar,
  messages: pipe2(baseCollection, withByIndex(LazyMessageProto), withById(LazyMessageProto)),
  mailboxes: null as any,  // recursive - assigned below
};
MailboxProto.mailboxes = pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto));
```

## Build

Files concatenate with `--outFile` for JXA (no module system):

```bash
# Notes only (proves independence from mail.ts)
npx tsc scratch/framework.ts scratch/jxa-backing.ts scratch/notes.ts scratch/test.ts \
  --outFile scratch/test.js --module None --target ES2020

osascript -l JavaScript scratch/test.js
```

## Testing Approach

MockDelegate enables Node.js unit tests without osascript:

```typescript
const mockData = {
  name: 'Mail',
  accounts: [{ name: 'Exchange', mailboxes: [...] }]
};

const delegate = createMockDelegate(mockData, 'mail');
const mail = getMailApp(delegate);
// Same API, no JXA required
```
