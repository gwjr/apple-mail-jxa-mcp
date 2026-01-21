// Test the plugboard model against real JXA
// Run with: npx ts-node scratch/test-plugboard.ts
// Or: npx tsx scratch/test-plugboard.ts

import { run } from '@jxa/run';

// ─────────────────────────────────────────────────────────────────────────────
// Inline the plugboard implementation (until it's a proper module)
// ─────────────────────────────────────────────────────────────────────────────

// Plugs
interface Resolve<T> {
  resolve(): T;
}

interface ByIndexPlug<Item = unknown> {
  byIndex(n: number): Item;
}

interface ByNamePlug<Item = unknown> {
  byName(name: string): Item;
}

// Branded addressing types
declare const ByIndexBrand: unique symbol;
declare const ByNameBrand: unique symbol;
type ByIndex = { readonly [ByIndexBrand]: never };
type ByName = { readonly [ByNameBrand]: never };

// Delegate
interface Delegate {
  resolve<T>(key: string): T;
  set<T>(key: string, value: T): void;
  byIndex(key: string, index: number): Delegate;
  byName(key: string, name: string): Delegate;
  byId(key: string, id: string | number): Delegate;
  prop(key: string): Delegate;
}

class JXABacking {
  constructor(public app: any) {}
  rootDelegate(): JXADelegate {
    return new JXADelegate(this, this.app);
  }
}

class JXADelegate implements Delegate {
  constructor(public backing: JXABacking, public _jxa: any) {}
  resolve<T>(key: string): T { return this._jxa[key](); }
  set<T>(key: string, value: T): void { this._jxa[key] = value; }
  byIndex(key: string, index: number): JXADelegate {
    return new JXADelegate(this.backing, this._jxa[key][index]);
  }
  byName(key: string, name: string): JXADelegate {
    return new JXADelegate(this.backing, this._jxa[key].byName(name));
  }
  byId(key: string, id: string | number): JXADelegate {
    return new JXADelegate(this.backing, this._jxa[key].byId(id));
  }
  prop(key: string): JXADelegate {
    return new JXADelegate(this.backing, this._jxa[key]);
  }
}

// Res type
type Res<Plugs, B extends Delegate> = Plugs & { _backing: B; _key: string };

// Schema types (pure type-level)
type Scalar<T> = { _kind: 'scalar'; _type: T; _settable: false };
type Collection<ItemSchema, Addressing extends unknown[]> = {
  _kind: 'collection';
  _itemSchema: ItemSchema;
  _addressing: Addressing;
};
type Compound = { [key: string]: any };

// Has helper
type Has<T, Tuple> = T extends Tuple[number & keyof Tuple] ? true : false;

// Plugs from schema
type PlugsFor<S, B extends Delegate> =
  S extends { _kind: 'scalar'; _type: infer T }
    ? Resolve<T>
  : S extends { _kind: 'collection'; _itemSchema: infer Item; _addressing: infer Addr }
    ? (Has<ByIndex, Addr> extends true ? ByIndexPlug<Res<PlugsFor<Item, B>, B>> : {})
    & (Has<ByName, Addr> extends true ? ByNamePlug<Res<PlugsFor<Item, B>, B>> : {})
  : S extends Compound
    ? { [K in keyof S]: Res<PlugsFor<S[K], B>, B> }
  : never;

type ResFrom<S, B extends Delegate> = Res<PlugsFor<S, B>, B>;

// Schemas
type AccountSchema = {
  name: Scalar<string>;
};

type ApplicationSchema = {
  name: Scalar<string>;
  version: Scalar<string>;
  accounts: Collection<AccountSchema, [ByName, ByIndex]>;
};

// Domain types
type Application = ResFrom<ApplicationSchema, JXADelegate>;
type Account = ResFrom<AccountSchema, JXADelegate>;

// ─────────────────────────────────────────────────────────────────────────────
// Cords - the wiring for plugs
// ─────────────────────────────────────────────────────────────────────────────

type ResBase<B extends Delegate> = { _backing: B; _key: string };

const Cords = {
  resolve: <T>(res: ResBase<JXADelegate>): T => {
    return res._backing._jxa[res._key]();
  },

  byIndex: <Item>(
    res: ResBase<JXADelegate>,
    index: number,
    materialize: (d: JXADelegate) => Item
  ): Item => {
    const itemJxa = res._backing._jxa[res._key][index];
    const itemDelegate = new JXADelegate(res._backing.backing, itemJxa);
    return materialize(itemDelegate);
  },

  byName: <Item>(
    res: ResBase<JXADelegate>,
    name: string,
    materialize: (d: JXADelegate) => Item
  ): Item => {
    const itemJxa = res._backing._jxa[res._key].byName(name);
    const itemDelegate = new JXADelegate(res._backing.backing, itemJxa);
    return materialize(itemDelegate);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Materializers
// ─────────────────────────────────────────────────────────────────────────────

function scalar<T>(backing: JXADelegate, key: string): Res<Resolve<T>, JXADelegate> {
  return {
    _backing: backing,
    _key: key,
    resolve: function() { return Cords.resolve<T>(this); },
  };
}

function collection<Item>(
  backing: JXADelegate,
  key: string,
  materialize: (d: JXADelegate) => Item
): Res<ByIndexPlug<Item> & ByNamePlug<Item>, JXADelegate> {
  return {
    _backing: backing,
    _key: key,
    byIndex: function(n) { return Cords.byIndex(this, n, materialize); },
    byName: function(name) { return Cords.byName(this, name, materialize); },
  };
}

function Account(delegate: JXADelegate): Account {
  return {
    _backing: delegate,
    _key: '',
    name: scalar<string>(delegate, 'name'),
  } as Account;
}

function Application(delegate: JXADelegate): Application {
  return {
    _backing: delegate,
    _key: '',
    name: scalar<string>(delegate, 'name'),
    version: scalar<string>(delegate, 'version'),
    accounts: collection(delegate, 'accounts', Account),
  } as Application;
}

function getMailApp(jxaApp: any): Application {
  const backing = new JXABacking(jxaApp);
  return Application(backing.rootDelegate());
}

// ─────────────────────────────────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // This runs in the JXA context
  const result = await run(() => {
    const app = Application('Mail');
    // Return raw data that we can wrap
    return {
      name: app.name(),
      version: app.version(),
      accountNames: app.accounts().map((a: any) => a.name()),
    };
  });

  console.log('Direct JXA result:');
  console.log('  App name:', result.name);
  console.log('  Version:', result.version);
  console.log('  Accounts:', result.accountNames);

  // Now test with our model
  // Problem: @jxa/run executes the function in JXA context,
  // but our classes (JXADelegate, etc.) are defined in Node context.
  // We need a different approach for actual testing.

  console.log('\n(Note: The plugboard model needs to be tested via osascript or bundled JXA)');
}

main().catch(console.error);
