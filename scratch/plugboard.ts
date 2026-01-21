// scratch/plugboard.ts - Plugboard Type Model v3
//
// Architecture:
// - Schemas are pure types (structure)
// - Overrides are values (behavior)
// - Materialize<Schema, Overrides> bundles them
// - Only Materialized types can be used with ResFrom
// - Overrides are nested, mirroring schema structure

// ─────────────────────────────────────────────────────────────────────────────
// Brands
// ─────────────────────────────────────────────────────────────────────────────

declare const ScalarBrand: unique symbol;
declare const CollectionBrand: unique symbol;
declare const PlugsBrand: unique symbol;
declare const LazyBrand: unique symbol;
declare const EagerBrand: unique symbol;
declare const MaterializeBrand: unique symbol;

declare const PlugMarker: unique symbol;
declare const ByIndexBrand: unique symbol;
declare const ByNameBrand: unique symbol;
declare const ByIdBrand: unique symbol;
declare const SettableBrand: unique symbol;
declare const MoveBrand: unique symbol;

type Plug = { readonly [PlugMarker]: true };
type ByIndex = Plug & { readonly [ByIndexBrand]: never };
type ByName = Plug & { readonly [ByNameBrand]: never };
type ById = Plug & { readonly [ByIdBrand]: never };
type Settable = Plug & { readonly [SettableBrand]: never };
type Move = Plug & { readonly [MoveBrand]: never };

// ─────────────────────────────────────────────────────────────────────────────
// Lazy wrapper
// ─────────────────────────────────────────────────────────────────────────────

type Lazy<T> = { readonly [LazyBrand]: T };

// ─────────────────────────────────────────────────────────────────────────────
// Schema types - internal building blocks
// ─────────────────────────────────────────────────────────────────────────────

type Scalar<T> =
  T extends Lazy<infer Inner>
    ? { readonly [ScalarBrand]: Inner; readonly [LazyBrand]: true }
    : { readonly [ScalarBrand]: T; readonly [EagerBrand]: true };

type Collection<Item, Plugs extends Plug[]> =
  Item extends Lazy<infer Inner>
    ? { readonly [CollectionBrand]: Inner; readonly [PlugsBrand]: Plugs; readonly [LazyBrand]: true }
    : { readonly [CollectionBrand]: Item; readonly [PlugsBrand]: Plugs; readonly [EagerBrand]: true };

type RW<T> =
  T extends Lazy<infer Inner>
    ? { readonly [ScalarBrand]: Inner; readonly [LazyBrand]: true; readonly [SettableBrand]: true }
    : { readonly [ScalarBrand]: T; readonly [EagerBrand]: true; readonly [SettableBrand]: true };

type AnySchema =
  | { readonly [ScalarBrand]: any }
  | { readonly [CollectionBrand]: any }
  | { [key: string]: AnySchema };

// ─────────────────────────────────────────────────────────────────────────────
// Materialize - bundles schema + overrides
// ─────────────────────────────────────────────────────────────────────────────

type Materialize<S extends AnySchema, O> = {
  readonly [MaterializeBrand]: true;
  readonly _schema: S;
  readonly _overrides: O;
};

// Helper to create Materialize type (no overrides)
type M<S extends AnySchema> = Materialize<S, {}>;

// Check if type is Materialized
type IsMaterialized<T> = T extends { readonly [MaterializeBrand]: true } ? true : false;

// Extract parts
type ExtractSchema<T> = T extends Materialize<infer S, any> ? S : never;
type ExtractOverrides<T> = T extends Materialize<any, infer O> ? O : never;

// ─────────────────────────────────────────────────────────────────────────────
// Type extraction utilities
// ─────────────────────────────────────────────────────────────────────────────

type ExtractScalarType<S> = S extends { readonly [ScalarBrand]: infer T } ? T : never;
type ExtractCollectionItem<S> = S extends { readonly [CollectionBrand]: infer I } ? I : never;
type ExtractPlugs<S> = S extends { readonly [PlugsBrand]: infer P } ? P : never;
type IsLazy<S> = S extends { readonly [LazyBrand]: true } ? true : false;
type IsSettable<S> = S extends { readonly [SettableBrand]: true } ? true : false;

type Has<T, Tuple> = Tuple extends readonly any[]
  ? T extends Tuple[number] ? true : false
  : false;

// ─────────────────────────────────────────────────────────────────────────────
// Specifier & Resolver
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: string };

interface Resolver {
  shouldInline(depth: number): boolean;
}

const DefaultResolver: Resolver = { shouldInline: (depth) => depth < 2 };
const EagerResolver: Resolver = { shouldInline: () => true };
const ShallowResolver: Resolver = { shouldInline: (depth) => depth === 0 };

// ─────────────────────────────────────────────────────────────────────────────
// Resolved types
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedDirect<S> =
  S extends { readonly [ScalarBrand]: infer T } ? T
  : S extends { readonly [CollectionBrand]: infer I } ? ResolvedDirect<UnwrapMaterialized<I>>[]
  : S extends { [key: string]: any }
    ? { [K in keyof S]: ResolvedDirect<UnwrapMaterialized<S[K]>> }
  : never;

type Resolved<S> =
  S extends { readonly [LazyBrand]: true } ? Specifier
  : S extends { readonly [ScalarBrand]: infer T } ? T
  : S extends { readonly [CollectionBrand]: infer I } ? Resolved<UnwrapMaterialized<I>>[]
  : S extends { [key: string]: any }
    ? { [K in keyof S]: Resolved<UnwrapMaterialized<S[K]>> }
  : never;

// Unwrap Materialize to get schema
type UnwrapMaterialized<T> = T extends Materialize<infer S, any> ? S : T;

// ─────────────────────────────────────────────────────────────────────────────
// Override types
// ─────────────────────────────────────────────────────────────────────────────

type OverrideMethods = {
  resolve?: (...args: any[]) => any;
  resolve_eager?: (...args: any[]) => any;
  exists?: (...args: any[]) => any;
  specifier?: (...args: any[]) => any;
};

// Overrides mirror schema structure
type Overrides<S extends AnySchema> =
  OverrideMethods
  & { [K in keyof S]?: S[K] extends AnySchema ? Overrides<S[K]> : never };

// ─────────────────────────────────────────────────────────────────────────────
// Plug interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface ByIndexPlug<Item> { byIndex(n: number): Item; }
interface ByNamePlug<Item> { byName(name: string): Item; }
interface ByIdPlug<Item> { byId(id: string | number): Item; }
interface SetPlug<T> { set(value: T): void; }
interface MovePlug<Dest> { move(to: Dest): void; }

// ─────────────────────────────────────────────────────────────────────────────
// Backing & Delegate
// ─────────────────────────────────────────────────────────────────────────────

interface Backing<Caps extends Plug[]> {
  _caps: Caps;
  basePrototype: object;
  lazyPrototype: object;
  createDelegate(): Delegate;
}

interface Delegate {
  backing: Backing<any>;
  prop(key: string): Delegate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Res & ResFrom
// ─────────────────────────────────────────────────────────────────────────────

interface ResBase<S> {
  resolve(resolver?: Resolver): ResolvedDirect<S>;
  resolve_eager(): Resolved<S>;
  exists(): boolean;
  specifier(): Specifier;
}

type BuildPlugInterfaces<S, B extends Backing<any[]>> =
  // Collection plugs - Item may be Materialized
  (S extends { readonly [CollectionBrand]: infer Item; readonly [PlugsBrand]: infer Plugs }
    ? (Has<ByIndex, Plugs> & Has<ByIndex, B['_caps']> extends true ? ByIndexPlug<ResFrom<Item, B>> : {})
    & (Has<ByName, Plugs> & Has<ByName, B['_caps']> extends true ? ByNamePlug<ResFrom<Item, B>> : {})
    & (Has<ById, Plugs> & Has<ById, B['_caps']> extends true ? ByIdPlug<ResFrom<Item, B>> : {})
    : {})
  // Settable
& (IsSettable<S> extends true ? SetPlug<ExtractScalarType<S>> : {})
  // Compound - properties may be Materialized
& (S extends { [key: string]: any }
    ? S extends { readonly [ScalarBrand]: any } ? {}
    : S extends { readonly [CollectionBrand]: any } ? {}
    : { [K in keyof S]: ResFrom<S[K], B> }
    : {});

type DelegateFor<B extends Backing<any[]>> = ReturnType<B['createDelegate']>;

// ResFrom accepts Materialized OR raw schema (for internal recursion)
// Overrides replace base methods via Omit
type ResFrom<T, B extends Backing<any[]>> =
  [T] extends [Materialize<infer S, infer O>]
    ? Omit<ResBase<S>, keyof O> & O & BuildPlugInterfaces<S, B> & { _delegate: DelegateFor<B> }
    : ResBase<T> & BuildPlugInterfaces<T, B> & { _delegate: DelegateFor<B> };

// ─────────────────────────────────────────────────────────────────────────────
// Path Segments for URI generation
// ─────────────────────────────────────────────────────────────────────────────

type PathSegment =
  | { kind: 'root'; scheme: string }
  | { kind: 'prop'; name: string }
  | { kind: 'index'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'id'; value: string | number };

function buildURI(segments: PathSegment[]): string {
  let uri = '';
  for (const seg of segments) {
    switch (seg.kind) {
      case 'root':
        uri = `${seg.scheme}://`;
        break;
      case 'prop':
        uri += (uri.endsWith('://') ? '' : '/') + seg.name;
        break;
      case 'index':
        uri += `[${seg.value}]`;
        break;
      case 'name':
        uri += '/' + encodeURIComponent(seg.value);
        break;
      case 'id':
        uri += '/' + encodeURIComponent(String(seg.value));
        break;
    }
  }
  return uri;
}

// ─────────────────────────────────────────────────────────────────────────────
// JXA Implementation
// ─────────────────────────────────────────────────────────────────────────────

class JXADelegate implements Delegate {
  constructor(
    public backing: JXABacking,
    public _jxa: any,
    public _path: PathSegment[],
    public _parent?: any,
    public _key?: string
  ) {}

  prop(key: string): JXADelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    return new JXADelegate(this.backing, this._jxa[key], newPath, this._jxa, key);
  }

  byIndex(n: number): JXADelegate {
    const newPath = [...this._path, { kind: 'index' as const, value: n }];
    return new JXADelegate(this.backing, this._jxa[n], newPath);
  }

  byName(name: string): JXADelegate {
    const newPath = [...this._path, { kind: 'name' as const, value: name }];
    return new JXADelegate(this.backing, this._jxa.byName(name), newPath);
  }

  byId(id: string | number): JXADelegate {
    const newPath = [...this._path, { kind: 'id' as const, value: id }];
    return new JXADelegate(this.backing, this._jxa.byId(id), newPath);
  }

  uri(): string {
    return buildURI(this._path);
  }
}

const JXABasePrototype = {
  resolve(this: { _delegate: JXADelegate }, resolver: Resolver = DefaultResolver): any {
    const d = this._delegate;
    if (d._parent && d._key) {
      return d._parent[d._key]();
    }
    return d._jxa();
  },

  resolve_eager(this: { _delegate: JXADelegate }): any {
    return (this as any).resolve();
  },

  exists(this: { _delegate: JXADelegate }): boolean {
    try {
      const d = this._delegate;
      if (d._parent && d._key) d._parent[d._key]();
      else d._jxa();
      return true;
    } catch { return false; }
  },

  specifier(this: { _delegate: JXADelegate }): Specifier {
    return { uri: this._delegate.uri() };
  },

  byIndex(this: { _delegate: JXADelegate; _overrides?: any }, n: number): any {
    const itemDelegate = this._delegate.byIndex(n);
    const itemOverrides = this._overrides?.['*'] || {};
    const isItemLazy = this._overrides?._itemLazy === true;
    return createRes(itemDelegate, itemOverrides, isItemLazy);
  },

  byName(this: { _delegate: JXADelegate; _overrides?: any }, name: string): any {
    const itemDelegate = this._delegate.byName(name);
    const itemOverrides = this._overrides?.['*'] || {};
    const isItemLazy = this._overrides?._itemLazy === true;
    return createRes(itemDelegate, itemOverrides, isItemLazy);
  },

  byId(this: { _delegate: JXADelegate; _overrides?: any }, id: string | number): any {
    const itemDelegate = this._delegate.byId(id);
    const itemOverrides = this._overrides?.['*'] || {};
    const isItemLazy = this._overrides?._itemLazy === true;
    return createRes(itemDelegate, itemOverrides, isItemLazy);
  },

  set(this: { _delegate: JXADelegate }, value: any): void {
    const d = this._delegate;
    if (d._parent && d._key) d._parent[d._key] = value;
    else throw new Error('Cannot set on root object');
  },
};

const JXALazyPrototype = {
  ...JXABasePrototype,
  resolve_eager(this: { _delegate: JXADelegate }): Specifier {
    return (this as any).specifier();
  },
};

type JXACaps = [ByIndex, ByName, ById, Settable];

class JXABacking implements Backing<JXACaps> {
  _caps!: JXACaps;
  basePrototype = JXABasePrototype;
  lazyPrototype = JXALazyPrototype;

  constructor(public app: any, public scheme: string = 'mail') {}

  createDelegate(): JXADelegate {
    const rootPath: PathSegment[] = [{ kind: 'root', scheme: this.scheme }];
    return new JXADelegate(this, this.app, rootPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createRes - with override support
// ─────────────────────────────────────────────────────────────────────────────

// Metadata markers in overrides:
//   _lazy: true      - this element is lazy (resolve_eager returns specifier)
//   _itemLazy: true  - collection items are lazy

function createRes<B extends Backing<any[]>>(
  delegate: DelegateFor<B>,
  overrides: object = {},
  isLazy: boolean = false
): any {
  // Check for _lazy marker in overrides (allows override to specify laziness)
  const lazy = isLazy || (overrides as any)._lazy === true;
  const baseProto = lazy ? delegate.backing.lazyPrototype : delegate.backing.basePrototype;

  // Extract method overrides (functions at top level)
  const overrideMethods: Record<string, any> = {};
  for (const key of Object.keys(overrides)) {
    if (typeof (overrides as any)[key] === 'function') {
      overrideMethods[key] = (overrides as any)[key];
    }
  }

  const proto = { ...baseProto, ...overrideMethods };
  const target = { _delegate: delegate, _overrides: overrides };

  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === '_delegate') return t._delegate;
      if (prop === '_overrides') return t._overrides;

      if (prop in proto) {
        const method = (proto as any)[prop];
        return typeof method === 'function' ? method.bind(t) : method;
      }

      // Property access - propagate nested overrides
      const childDelegate = t._delegate.prop(prop);
      const childOverrides = (t._overrides as any)?.[prop] || {};
      const isChildLazy = childOverrides._lazy === true;
      return createRes(childDelegate, childOverrides, isChildLazy);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: Schemas (internal, pure types)
// ─────────────────────────────────────────────────────────────────────────────

type _AttachmentSchema = {
  name: Scalar<string>;
  size: Scalar<number>;
  content: Scalar<Lazy<ArrayBuffer>>;
};

type _MessageSchema = {
  subject: Scalar<string>;
  sender: Scalar<string>;
  dateSent: Scalar<Date>;
  isRead: RW<boolean>;
  content: Scalar<Lazy<string>>;
  attachments: Collection<Lazy<AttachmentType>, [ByIndex]>;
};

type _MailboxSchema = {
  name: Scalar<string>;
  unreadCount: Scalar<number>;
  messages: Collection<Lazy<MessageType>, [ByIndex, ById]>;
  mailboxes: Collection<MailboxType, [ByIndex, ByName]>;
};

type _AccountSchema = {
  name: Scalar<string>;
  email: Scalar<string>;
  mailboxes: Collection<MailboxType, [ByIndex, ByName]>;
};

type _ApplicationSchema = {
  name: Scalar<string>;
  version: Scalar<string>;
  accounts: Collection<AccountType, [ByIndex, ByName]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Example: Overrides (values, behavior)
// ─────────────────────────────────────────────────────────────────────────────

const AttachmentOverrides = {};

const MessageOverrides = {
  // Custom resolve for messages - returns preview
  resolve(): { subject: string; sender: string; preview: string } {
    const self = this as any;
    return {
      subject: self.subject.resolve(),
      sender: self.sender.resolve(),
      preview: (self.content.resolve() || '').substring(0, 100),
    };
  },
  // Nested: custom content resolution
  content: {
    resolve(): string {
      const raw = (this as any)._delegate._jxa() || '';
      return raw.replace(/<[^>]*>/g, '');  // Strip HTML
    }
  }
};

const MailboxOverrides = {};
const AccountOverrides = {};
const ApplicationOverrides = {};

// ─────────────────────────────────────────────────────────────────────────────
// Example: Materialized types (public API)
// ─────────────────────────────────────────────────────────────────────────────

type AttachmentType = Materialize<_AttachmentSchema, typeof AttachmentOverrides>;
type MessageType = Materialize<_MessageSchema, typeof MessageOverrides>;
type MailboxType = Materialize<_MailboxSchema, typeof MailboxOverrides>;
type AccountType = Materialize<_AccountSchema, typeof AccountOverrides>;
type ApplicationType = Materialize<_ApplicationSchema, typeof ApplicationOverrides>;

// ─────────────────────────────────────────────────────────────────────────────
// Domain types (Res)
// ─────────────────────────────────────────────────────────────────────────────

type Attachment = ResFrom<AttachmentType, JXABacking>;
type Message = ResFrom<MessageType, JXABacking>;
type Mailbox = ResFrom<MailboxType, JXABacking>;
type Account = ResFrom<AccountType, JXABacking>;
type Application = ResFrom<ApplicationType, JXABacking>;

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function getMailApp(jxaApp: any): Application {
  const backing = new JXABacking(jxaApp);
  return createRes(backing.createDelegate(), ApplicationOverrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage examples (type-level)
// ─────────────────────────────────────────────────────────────────────────────

declare const app: Application;

// Baseline methods
const appName: string = app.name.resolve();
const appExists: boolean = app.name.exists();

// Collection navigation
const account: Account = app.accounts.byIndex(0);
const accountByName: Account = app.accounts.byName('Exchange');

// Nested access
const mailbox: Mailbox = account.mailboxes.byName('INBOX');
const unread: number = mailbox.unreadCount.resolve();

// Message with custom resolve (from overrides)
declare const message: Message;
const preview: { subject: string; sender: string; preview: string } = message.resolve();

// Direct content resolution (custom override strips HTML)
const cleanContent: string = message.content.resolve();

// Normal property (no override)
const subject: string = message.subject.resolve();

// RW scalar test
message.isRead.set(true);  // ✓ Works with [T] distribution fix
