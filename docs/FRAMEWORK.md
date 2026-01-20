# Framework Architecture: Ground-Up Explanation

## The Problem Being Solved

This framework bridges two very different worlds:
1. **JXA (JavaScript for Automation)** - Apple's scripting interface to Mail.app, which returns mutable AppleScript objects with imperative methods like `name()`, `messages()`, etc.
2. **MCP (Model Context Protocol)** - A RESTful, URI-based resource protocol where everything is addressable by URI and resources are immutable data structures.

The core challenge: How do you expose a deeply nested, imperative object graph (accounts → mailboxes → messages → attachments) as a clean, discoverable, URI-addressable resource tree?

---

## Layer 1: The Schema DSL (`framework/schema.ts`)

The foundation is a **declarative schema language** that describes the shape of data:

```typescript
const t = {
  string: { _t: 'string' },
  number: { _t: 'number' },
  boolean: { _t: 'boolean' },
  date: { _t: 'date' },
  array: <T>(elem: T) => ({ _t: 'array', _elem: elem }),
};
```

These are **type markers** - objects with a `_t` discriminator that identify primitive types.

**Addressing markers** specify how collections can be accessed:
```typescript
const by = {
  name: { _by: 'name' },   // byName("INBOX")
  index: { _by: 'index' }, // byIndex(0)
  id: { _by: 'id' },       // byId(173672)
};
```

**Modifiers** add behavior to properties:
- `lazy(type)` - property isn't fetched until explicitly requested (e.g., message body)
- `rw(type)` - property is read-write (can be set)
- `jxa(type, name)` - JXA property has different name than schema property
- `computed(fn)` - value is computed from JXA object, not a direct property
- `collection(schema, [addressing], opts)` - defines a nested collection

This gives you a concise DSL to define schemas like:

```typescript
const MessageSchema = {
  id: t.number,
  subject: t.string,
  content: lazy(t.string),        // Don't fetch body in listings
  sender: computed((jxa) => parseEmailAddress(jxa.sender())),
  toRecipients: collection(RecipientSchema, [by.name, by.index]),
  attachments: jxa(collection(AttachmentSchema, [by.name, by.index]), 'mailAttachments'),
};
```

---

## Layer 2: The Type System (`framework/specifier.ts`)

The type system defines what a **Specifier** is - a lazy reference to data:

```typescript
type Specifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T>;           // Actually fetch the data
  fix(): Result<Specifier<T>>;    // Stabilize the URI
};
```

Key insight: A specifier is **not** the data itself. It's a *reference* that can be resolved to data. This enables:
- **Lazy evaluation** - don't fetch until needed
- **URI stability** - convert `accounts[0]` to `accounts/iCloud` via `fix()`
- **Chainable operations** - filtering, sorting, pagination

**CollectionSpecifier** adds query operations:
```typescript
type CollectionSpecifier<T> = {
  whose(filter: WhoseFilter<T>): CollectionSpecifier<T>;
  sortBy(spec: SortSpec<T>): CollectionSpecifier<T>;
  paginate(spec: PaginationSpec): CollectionSpecifier<T>;
  expand(props: ExpandSpec): CollectionSpecifier<T>;
  byIndex(i: number): Specifier<T>;
  byName?(name: string): Specifier<T>;
  byId?(id: string | number): Specifier<T>;
};
```

---

## Layer 3: The Runtime (`framework/runtime.ts`)

This is where schemas become executable. The key function is **`createDerived(schema, typeName)`** which generates a class from a schema.

For each property in the schema, it creates a getter that:
1. For **scalar properties** (`t.string`, etc.): calls `jxa[propertyName]()` and converts the result
2. For **lazy properties**: returns a `Specifier` instead of the value directly
3. For **computed properties**: invokes the compute function
4. For **collections**: returns a `CollectionSpecifier` for the nested collection

**`createElemSpec()`** creates element specifiers with:
- A `resolve()` that instantiates the derived class
- A `fix()` that tries to stabilize the URI (prefer id/name over index)
- Property accessors that delegate to nested specifiers

**`createCollSpec()`** creates collection specifiers with:
- Query methods (`whose`, `sortBy`, `paginate`, `expand`) that return new collection specifiers
- Addressing methods (`byIndex`, `byName`, `byId`) based on the schema's addressing markers
- A `resolve()` that iterates the JXA collection and returns an array of resolved items

The critical pattern: **each operation returns a new specifier** with the query parameters encoded in the URI. When you call `.whose({read: {equals: false}}).paginate({limit: 10})`, you get back a specifier with URI `mail://inbox/messages?read=false&limit=10`.

---

## Layer 4: URI Resolution (`framework/uri.ts`)

This layer maps URIs to specifiers. The registry pattern:

```typescript
const schemeRoots: Record<string, () => any> = {};
registerScheme('mail', getMailApp);  // mail:// → MailApp specifier
```

**`specifierFromURI(uri)`** is the core function. It:
1. Parses the scheme (e.g., `mail://`)
2. Looks up the root factory for that scheme
3. Walks path segments, using navigation logic:
   - Named property on current object? Use it.
   - Collection with `byName`? Call `byName(segment)`.
   - Collection with `byId`? Call `byId(segment)`.
   - Navigation hook matches? Use hooked specifier.
   - Index notation `[n]`? Call `byIndex(n)`.
4. Parses query string for filter/sort/pagination/expand
5. Applies query operations to the specifier

**Navigation hooks** allow custom routing. For example, `mail://accounts/iCloud/inbox` doesn't literally have an `inbox` property - a hook intercepts it and returns the account's inbox mailbox.

**Completion hooks** power autocomplete by suggesting valid next segments.

---

## Layer 5: Domain Model (`mail.ts`)

This layer applies the framework to Apple Mail specifically. It defines:

**Schemas for all domain objects:**
- `SettingsSchema` - Mail.app preferences
- `AccountSchema` - Email accounts
- `MailboxSchema` - Mailboxes (recursive - contains child mailboxes)
- `MessageSchema` - Email messages
- `RuleSchema`, `SignatureSchema` - Mail rules and signatures

**Derived classes** generated from schemas:
```typescript
const Message = createDerived(MessageSchema, 'Message');
const Account = createDerived(AccountSchema, 'Account');
```

**The entry point** `getMailApp()`:
1. Creates a JXA connection to Mail.app
2. Wraps it with the MailApp derived class
3. Adds standard mailbox shortcuts (inbox, sent, drafts, etc.)
4. Registers the `mail://` scheme

**Navigation hooks** for special cases like account-level standard mailboxes.

---

## Architectural Design Decisions

1. **Resources-first**: Read operations are prioritized. The resource tree is complete and discoverable before write operations are added.

2. **URI stability via `fix()`**: Index-based URIs (`accounts[0]`) are fragile. The `fix()` method converts them to stable id/name-based URIs (`accounts/iCloud`).

3. **Lazy properties**: Heavy data (message content, attachments) isn't fetched in listings. Use `?expand=content` to include them.

4. **Specifier pattern**: Separation between *reference* and *data* enables lazy evaluation, query chaining, and URI tracking.

5. **Schema-driven**: Domain logic is captured declaratively in schemas. The runtime generates all the boilerplate.

6. **Recursive structure**: Mailboxes can contain mailboxes. The same patterns work at any nesting level.

---

## How a Request Flows

```
mail://accounts/iCloud/mailboxes/INBOX/messages?read=false&limit=10
```

1. `specifierFromURI()` parses the URI
2. Looks up `mail://` scheme → `getMailApp()` returns root specifier
3. Walks path: `accounts` → `byName("iCloud")` → `mailboxes` → `byName("INBOX")` → `messages`
4. Parses query: `{filter: {read: {equals: false}}, pagination: {limit: 10}}`
5. Applies: `.whose({read: {equals: false}}).paginate({limit: 10})`
6. Returns collection specifier with the query-encoded URI
7. When `resolve()` is called:
   - Iterates JXA messages collection
   - Creates derived Message instances
   - Applies JS-side filtering (if JXA `whose` failed)
   - Sorts and paginates
   - Returns array of resolved message objects

---

## Adding New Features

This layered approach means adding support for a new Mail.app feature is just a matter of updating the schema - the runtime, URI parsing, and query operations all come for free.

To add a new entity type:
1. Define its schema using the DSL
2. Add it to a parent schema's collection
3. Generate the derived class with `createDerived()`

To add write operations:
1. Use `rw(type)` for settable properties
2. Use `collection(schema, addressing, { create: true, delete: true })` for mutable collections
3. The runtime will add `set()`, `create()`, and `delete()` methods automatically
