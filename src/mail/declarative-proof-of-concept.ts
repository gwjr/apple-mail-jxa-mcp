/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />

// ============================================================================
// Proof of Concept: Declarative JXA Schema System
// ============================================================================

// ============================================================================
// Helpers
// ============================================================================

function str(val: unknown): string {
  return val == null ? '' : '' + val;
}

function tryResolve<T>(fn: () => T, context: string): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: `${context}: ${e}` };
  }
}

// Result<T> is defined in mail-app.d.ts

// ============================================================================
// Core Type Descriptors
// ============================================================================

type JXAAccessor<T, JXAName extends string> = {
  readonly _accessor: true;
  readonly _type: T;
  readonly _jxaName: JXAName;
};

type JXALazyAccessor<T, JXAName extends string> = {
  readonly _lazyAccessor: true;
  readonly _type: T;
  readonly _jxaName: JXAName;
};

type JXACollection<ElementBase, JXAName extends string, Addressing extends readonly AddressingMode[]> = {
  readonly _collection: true;
  readonly _elementBase: ElementBase;
  readonly _jxaName: JXAName;
  readonly _addressing: Addressing;
};

type AddressingMode = 'name' | 'index' | 'id';

// ============================================================================
// Helper Functions for Schema Definition
// ============================================================================

function accessor<T, JXAName extends string>(
  jxaName: JXAName
): JXAAccessor<T, JXAName> {
  return {
    _accessor: true,
    _type: undefined as any as T,
    _jxaName: jxaName
  };
}

function lazyAccessor<T, JXAName extends string>(
  jxaName: JXAName
): JXALazyAccessor<T, JXAName> {
  return {
    _lazyAccessor: true,
    _type: undefined as any as T,
    _jxaName: jxaName
  };
}

function collection<ElementBase, JXAName extends string, Addressing extends readonly AddressingMode[]>(
  jxaName: JXAName,
  elementBase: ElementBase,
  addressing: Addressing
): JXACollection<ElementBase, JXAName, Addressing> {
  return {
    _collection: true,
    _elementBase: elementBase,
    _jxaName: jxaName,
    _addressing: addressing
  };
}

// ============================================================================
// Type-Level Transformations
// ============================================================================

// Lower accessor/collection to concrete type
type Lower<A> =
  A extends JXAAccessor<infer T, any> ? T :
  A extends JXALazyAccessor<infer T, any> ? Specifier<T> :  // lazy stays as specifier
  A extends JXACollection<infer ElementBase, any, any> ? CollectionSpecifier<Derived<ElementBase>> :
  A;

// Lower all properties
type LowerAll<Base> = {
  [K in keyof Base]: Lower<Base[K]>;
};

// Derived type = lowered properties
type Derived<Base> = LowerAll<Base>;

// Derived constructor
type DerivedConstructor<Base extends Record<string, any>> = {
  new(_jxa: any, _uri?: string): LowerAll<Base>;
  fromJXA(_jxa: any, _uri?: string): LowerAll<Base>;
};

// ============================================================================
// Specifier Types
// ============================================================================

// Lift: scalar → Specifier<scalar>, Specifier<X> → Specifier<X>
type Lift<T> = T extends { readonly _isSpecifier: true }
  ? T
  : Specifier<T>;

// Specifier: wraps T, exposes lifted properties, has resolve()
type Specifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T>;
} & {
  readonly [K in keyof T]: Lift<T[K]>;
};

// Addressing capabilities
type NameAddressable<T> = { byName(name: string): Specifier<T> };
type IdAddressable<T> = { byId(id: string | number): Specifier<T> };
type IndexAddressable<T> = { byIndex(i: number): Specifier<T> };

// Build addressing type from mode list
type AddressingFromModes<T, Modes> =
  Modes extends readonly ['name', 'index', 'id'] ? NameAddressable<T> & IndexAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['name', 'index'] ? NameAddressable<T> & IndexAddressable<T> :
  Modes extends readonly ['name', 'id'] ? NameAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['index', 'id'] ? IndexAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['name'] ? NameAddressable<T> :
  Modes extends readonly ['index'] ? IndexAddressable<T> :
  Modes extends readonly ['id'] ? IdAddressable<T> :
  IndexAddressable<T>; // Default fallback

// Collection specifier
type CollectionSpecifier<T, A = IndexAddressable<T>> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T[]>;
} & A;

// ============================================================================
// Runtime Implementation Factory
// ============================================================================

function createDerived<Base extends Record<string, any>>(
  schema: Base,
  typeName: string
): DerivedConstructor<Base> {

  class DerivedClass {
    private _jxa: any;
    private _uri?: string;

    constructor(_jxa: any, _uri?: string) {
      this._jxa = _jxa;
      this._uri = _uri;
      this._initializeProperties();
    }

    static fromJXA(_jxa: any, _uri?: string): LowerAll<Base> {
      return new DerivedClass(_jxa, _uri) as any;
    }
    
    private _initializeProperties() {
      for (const [key, descriptor] of Object.entries(schema)) {
        if (this._isAccessor(descriptor)) {
          this._defineAccessorProperty(key, descriptor);
        } else if (this._isLazyAccessor(descriptor)) {
          this._defineLazyAccessorProperty(key, descriptor);
        } else if (this._isCollection(descriptor)) {
          this._defineCollectionProperty(key, descriptor);
        }
      }
    }

    private _isAccessor(desc: any): desc is JXAAccessor<any, any> {
      return desc && desc._accessor === true;
    }

    private _isLazyAccessor(desc: any): desc is JXALazyAccessor<any, any> {
      return desc && desc._lazyAccessor === true;
    }

    private _isCollection(desc: any): desc is JXACollection<any, any, any> {
      return desc && desc._collection === true;
    }

    private _defineAccessorProperty(key: string, descriptor: JXAAccessor<any, any>) {
      Object.defineProperty(this, key, {
        get() {
          const value = this._jxa[descriptor._jxaName]();
          return this._convertValue(value);
        },
        enumerable: true
      });
    }

    private _defineLazyAccessorProperty(key: string, descriptor: JXALazyAccessor<any, any>) {
      const self = this;
      Object.defineProperty(this, key, {
        get() {
          const uri = self._uri
            ? `${self._uri}/${key}`
            : `${typeName.toLowerCase()}://.../${key}`;
          return scalarSpecifier(uri, () => {
            const value = self._jxa[descriptor._jxaName]();
            return self._convertValue(value);
          });
        },
        enumerable: true
      });
    }

    private _defineCollectionProperty(key: string, descriptor: JXACollection<any, any, any>) {
      const self = this;
      Object.defineProperty(this, key, {
        get() {
          const jxaCollection = self._jxa[descriptor._jxaName];
          const uri = self._uri
            ? `${self._uri}/${key}`
            : `${typeName.toLowerCase()}://.../${key}`;
          return createCollectionSpecifier(
            uri,
            jxaCollection,
            descriptor._elementBase,
            descriptor._addressing,
            typeName + '_' + key
          );
        },
        enumerable: true
      });
    }
    
    private _convertValue(value: any): any {
      if (value == null) return '';
      if (Array.isArray(value)) return value.map(v => this._convertValue(v));
      return value;
    }
  }
  
  return DerivedClass as any as DerivedConstructor<Base>;
}

// ============================================================================
// Specifier Factories
// ============================================================================

// Helper for scalar specifiers
function scalarSpecifier<T>(uri: string, getValue: () => T): Specifier<T> {
  return {
    _isSpecifier: true as const,
    uri,
    resolve(): Result<T> {
      return tryResolve(getValue, uri);
    }
  } as Specifier<T>;
}

// Element specifier factory
function createElementSpecifier<Base extends Record<string, any>>(
  uri: string,
  jxa: any,
  schema: Base,
  typeName: string
): Specifier<Derived<Base>> {
  
  const ElementClass = createDerived(schema, typeName);
  
  const spec: any = {
    _isSpecifier: true as const,
    uri,
    
    resolve(): Result<Derived<Base>> {
      return tryResolve(() => ElementClass.fromJXA(jxa, uri), uri);
    }
  };
  
  // Add lifted property specifiers
  for (const [key, descriptor] of Object.entries(schema)) {
    if ('_accessor' in (descriptor as any) || '_lazyAccessor' in (descriptor as any)) {
      // Both accessor and lazyAccessor lift to Specifier<T> on a Specifier
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxa[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    } else if ('_collection' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const desc = descriptor as JXACollection<any, any, any>;
          return createCollectionSpecifier(
            `${uri}/${key}`,
            jxa[desc._jxaName],
            desc._elementBase,
            desc._addressing,
            typeName + '_' + key
          );
        },
        enumerable: true
      });
    }
  }
  
  return spec as Specifier<Derived<Base>>;
}

// Collection specifier factory
function createCollectionSpecifier<
  ElementBase extends Record<string, any>,
  Modes extends readonly AddressingMode[]
>(
  uri: string,
  jxaCollection: any,
  elementBase: ElementBase,
  addressing: Modes,
  typeName: string
): CollectionSpecifier<Derived<ElementBase>, AddressingFromModes<Derived<ElementBase>, Modes>> {
  
  const ElementClass = createDerived(elementBase, typeName);
  
  const spec: any = {
    _isSpecifier: true as const,
    uri,
    
    resolve(): Result<Derived<ElementBase>[]> {
      return tryResolve(() => {
        const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
        return jxaArray.map((jxa: any, i: number) => ElementClass.fromJXA(jxa, `${uri}[${i}]`));
      }, uri);
    }
  };
  
  // Add addressing methods
  if (addressing.includes('index')) {
    spec.byIndex = function(i: number): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(`${uri}[${i}]`, jxaCollection.at(i), elementBase, typeName);
    };
  }
  
  if (addressing.includes('name')) {
    spec.byName = function(name: string): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(
        `${uri}/${encodeURIComponent(name)}`,
        jxaCollection.byName(name),
        elementBase,
        typeName
      );
    };
  }
  
  if (addressing.includes('id')) {
    spec.byId = function(id: string | number): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(`${uri}/${id}`, jxaCollection.byId(id), elementBase, typeName);
    };
  }
  
  return spec as CollectionSpecifier<Derived<ElementBase>, AddressingFromModes<Derived<ElementBase>, typeof addressing>>;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const MessageBase = {
  id: accessor<number, 'id'>('id'),
  messageId: accessor<string, 'messageId'>('messageId'),
  subject: accessor<string, 'subject'>('subject'),
  sender: accessor<string, 'sender'>('sender'),
  replyTo: accessor<string, 'replyTo'>('replyTo'),
  dateSent: accessor<Date, 'dateSent'>('dateSent'),
  dateReceived: accessor<Date, 'dateReceived'>('dateReceived'),
  content: lazyAccessor<string, 'content'>('content'),  // lazy - expensive to fetch
  readStatus: accessor<boolean, 'readStatus'>('readStatus'),
  flaggedStatus: accessor<boolean, 'flaggedStatus'>('flaggedStatus'),
  junkMailStatus: accessor<boolean, 'junkMailStatus'>('junkMailStatus'),
  messageSize: accessor<number, 'messageSize'>('messageSize'),
} as const;

const MailboxBase = {
  name: accessor<string, 'name'>('name'),
  unreadCount: accessor<number, 'unreadCount'>('unreadCount'),
  messages: collection('messages', MessageBase, ['index', 'id'] as const)
} as const;

const AccountBase = {
  id: accessor<string, 'id'>('id'),
  name: accessor<string, 'name'>('name'),
  fullName: accessor<string, 'fullName'>('fullName'),
  emailAddresses: accessor<string[], 'emailAddresses'>('emailAddresses'),
  mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'] as const)
} as const;

// ============================================================================
// Create Derived Types
// ============================================================================

const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');

// ============================================================================
// Type Aliases for Export
// ============================================================================

type Mailbox = InstanceType<typeof Mailbox>;
type Account = InstanceType<typeof Account>;

// ============================================================================
// Entry Point
// ============================================================================

var Mail = {
  _app: null as MailApplication | null,

  get app(): MailApplication {
    if (!this._app) {
      const app = Application('Mail');
      if (typeof app.accounts === 'undefined') {
        throw new Error('Not connected to Mail.app');
      }
      this._app = app as MailApplication;
    }
    return this._app;
  },

  accounts(): CollectionSpecifier<Account, NameAddressable<Account> & IndexAddressable<Account> & IdAddressable<Account>> {
    return createCollectionSpecifier(
      'mail://accounts',
      this.app.accounts,
      AccountBase,
      ['name', 'index', 'id'] as const,
      'Account'
    );
  }
};

// Export for JXA
(globalThis as any).Mail = Mail;