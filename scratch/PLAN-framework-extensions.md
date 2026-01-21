# Framework Extensions Plan

## Overview

Extend framework.ts to support:
1. **jxaName mapping** - Property name differs between schema and JXA/mock
2. **computed properties** - Transform raw values or navigate to different JXA locations

Both must be app-agnostic and fit the existing plug architecture (prototype composition via spread/composers).

---

## Phase 1: jxaName Mapping

### Problem

Mail's `attachments` property maps to JXA's `mailAttachments`:
```typescript
// In Mail.app scripting dictionary, it's "mail attachments"
// In JXA: message.mailAttachments()
// In our schema: message.attachments
```

### Design

**Key insight**: The Delegate interface doesn't need to change. `prop(key)` just takes a string—it doesn't care if that string is the schema name or JXA name. The mapping happens at createRes.

**Implementation**:

1. Define a symbol for storing the jxaName:
```typescript
declare const JxaNameBrand: unique symbol;
type JxaNamedProto<P> = P & { readonly [JxaNameBrand]: string };
```

2. Create a composer function:
```typescript
function withJxaName<P extends object>(proto: P, jxaName: string): JxaNamedProto<P> {
  return Object.assign(Object.create(null), proto, { [JxaNameBrand]: jxaName });
}

function getJxaName(proto: object): string | undefined {
  return (proto as any)[JxaNameBrand];
}
```

3. Modify createRes to use jxaName:
```typescript
if (typeof value === 'object' && value !== null) {
  const jxaName = getJxaName(value) || (prop as string);
  return createRes(t._delegate.prop(jxaName), value);
}
```

### Usage in mail.ts

```typescript
const MessageProto = {
  ...baseScalar,
  // ... other properties ...
  attachments: withJxaName(
    pipe3(baseCollection, withByIndex(AttachmentProto), withByName(AttachmentProto), withById(AttachmentProto)),
    'mailAttachments'
  ),
};
```

### Mock Data Implication

Mock data should use JXA property names (since that's what the delegate sees):
```typescript
const mockMessage = {
  subject: 'Test',
  mailAttachments: [{ id: '1', name: 'file.pdf', fileSize: 1024 }]
};
```

This is correct—mock data mimics JXA structure, not schema structure.

---

## Phase 2: Computed Properties (Value Transformation)

### Problem

Some properties need transformation between JXA and schema:
```typescript
// JXA returns: "John Doe <john@example.com>"
// Schema should expose: { name: "John Doe", address: "john@example.com" }
```

### Design

A computed property is a proto that overrides `resolve()` to transform the raw value.

**Key insight**: The transformation function receives the raw value from `delegate._jxa()`. It doesn't know or care about JXA specifics—it just transforms data.

```typescript
function computed<T>(transform: (raw: any) => T): BaseProtoType {
  return {
    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      return transform(raw);
    },
    resolve_eager(this: { resolve(): T }) {
      return this.resolve();
    },
    exists(this: { _delegate: Delegate }) {
      try {
        this._delegate._jxa();
        return true;
      } catch {
        return false;
      }
    },
    specifier(this: { _delegate: Delegate }) {
      return { uri: this._delegate.uri() };
    },
  };
}
```

### Usage in mail.ts

```typescript
type ParsedEmailAddress = { name: string; address: string };

function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (!raw) return { name: '', address: '' };
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  // ... parsing logic ...
}

const MessageProto = {
  ...baseScalar,
  sender: computed<ParsedEmailAddress>(parseEmailAddress),
  replyTo: computed<ParsedEmailAddress>(parseEmailAddress),
  // ...
};
```

### Type Safety

The return type `T` flows through:
```typescript
type MessageRes = Res<typeof MessageProto>;
// messageRes.sender.resolve() returns ParsedEmailAddress
```

### Lazy Computed

For expensive computed properties:
```typescript
function lazyComputed<T>(transform: (raw: any) => T): BaseProtoType & { readonly [LazyBrand]: true } {
  return makeLazy(computed(transform));
}
```

### Mock Compatibility

The transform function works identically with mock data:
```typescript
const mockMessage = {
  sender: 'John Doe <john@example.com>'  // Raw string, just like JXA
};
// computed(parseEmailAddress) transforms it the same way
```

---

## Phase 3: Computed Navigation (Future)

### Problem

Some properties navigate to different JXA locations:
```typescript
// account.inbox should resolve to account.mailbox({ name: 'INBOX' })
// app.inbox should resolve to app.inbox (a different accessor)
```

### Challenge

This requires the computed to return a new delegate pointing elsewhere. Current architecture doesn't support this—delegates are created by the backing, not by protos.

### Possible Approaches

**Option A: Delegate.wrapRaw()**
```typescript
interface Delegate {
  // ... existing methods ...
  wrapRaw(raw: any): Delegate;  // Wrap arbitrary JXA/mock data
}
```

Then computed navigation could do:
```typescript
function computedNav<P extends object>(
  navigate: (raw: any) => any,
  proto: P
): P {
  return {
    ...proto,
    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      const target = navigate(raw);
      return this._delegate.wrapRaw(target)._jxa();
    },
  };
}
```

**Option B: Schema-level aliases**

Define navigation as a schema concern, not a delegate concern:
```typescript
const AccountProto = {
  ...baseScalar,
  inbox: alias('mailboxes', { name: 'INBOX' }),  // Shorthand for mailboxes.byName('INBOX')
};
```

**Option C: Defer to app-specific code**

Keep navigation in app code (mail.ts) using JXA directly, outside the proto system. This maintains clean separation but loses some ergonomics.

### Recommendation

Defer Phase 3 until we have concrete use cases working. Phase 1 and 2 solve the immediate problems (jxaName and email parsing). Standard mailboxes can be addressed later with more design thought.

---

## Implementation Order

1. **Phase 1: jxaName** (~20 lines in framework.ts)
   - Add JxaNameBrand symbol
   - Add withJxaName() composer
   - Add getJxaName() helper
   - Modify createRes to use jxaName

2. **Phase 2: computed** (~25 lines in framework.ts)
   - Add computed() function
   - Add lazyComputed() function (optional, just `makeLazy(computed(...))`)

3. **Update mail.ts**
   - Use withJxaName for attachments
   - Use computed for sender, replyTo
   - Add parseEmailAddress helper to mail.ts (app-specific)

4. **Update tests**
   - Verify jxaName works with JXA
   - Verify jxaName works with mock (using JXA property names in mock data)
   - Verify computed transforms work

---

## Non-Goals for Now

- Settings namespace (requires Phase 3 navigation)
- Standard mailboxes (requires Phase 3 navigation)
- Account.emailAddresses (requires computed that calls a method, not just reads a property)
- Rule.copyMessage/moveMessage (requires Phase 3 navigation)

These can be revisited after Phase 1 and 2 are working.
