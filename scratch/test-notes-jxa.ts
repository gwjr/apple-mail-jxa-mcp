// Test Notes.app support with plugboard v4
//
// Compile: npx tsc scratch/plugboard-v4.ts scratch/jxa-backing.ts scratch/test-notes-jxa.ts --outFile scratch/test-notes.js --target ES2020 --module None --lib ES2020 --strict
// Run: osascript -l JavaScript scratch/test-notes.js
//
// This demonstrates that the same proto system transfers to a different app.

declare function Application(name: string): any;
declare var console: { log(...args: any[]): void };

// ─────────────────────────────────────────────────────────────────────────────
// Notes Schema - prototype composition
// ─────────────────────────────────────────────────────────────────────────────

// Note proto
interface NoteProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  id: typeof eagerScalar;
  body: typeof eagerScalar;
  plaintext: ReturnType<typeof makeLazy<typeof baseScalar>>;
  creationDate: typeof eagerScalar;
  modificationDate: typeof eagerScalar;
}

const NoteProto: NoteProtoType = {
  ...baseScalar,
  name: eagerScalar,
  id: eagerScalar,
  body: eagerScalar,
  plaintext: makeLazy(baseScalar),
  creationDate: eagerScalar,
  modificationDate: eagerScalar,
};

const LazyNoteProto = makeLazy(NoteProto);

// Folder proto (recursive - contains folders and notes)
interface FolderProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  id: typeof eagerScalar;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
  folders: BaseProtoType & ByIndexProto<FolderProtoType> & ByNameProto<FolderProtoType>;
}

const FolderProto: FolderProtoType = {
  ...baseScalar,
  name: eagerScalar,
  id: eagerScalar,
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
  folders: null as any, // Placeholder for recursive reference
};

// Set up recursive reference
FolderProto.folders = pipe2(baseCollection, withByIndex(FolderProto), withByName(FolderProto));

// Account proto
interface NotesAccountProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  id: typeof eagerScalar;
  folders: BaseProtoType & ByIndexProto<typeof FolderProto> & ByNameProto<typeof FolderProto>;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
}

const NotesAccountProto: NotesAccountProtoType = {
  ...baseScalar,
  name: eagerScalar,
  id: eagerScalar,
  folders: pipe2(baseCollection, withByIndex(FolderProto), withByName(FolderProto)),
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
};

// Notes Application proto
interface NotesApplicationProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  version: typeof eagerScalar;
  accounts: BaseProtoType & ByIndexProto<typeof NotesAccountProto> & ByNameProto<typeof NotesAccountProto>;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
  folders: BaseProtoType & ByIndexProto<typeof FolderProto> & ByNameProto<typeof FolderProto>;
}

const NotesApplicationProto: NotesApplicationProtoType = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe2(baseCollection, withByIndex(NotesAccountProto), withByName(NotesAccountProto)),
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
  folders: pipe2(baseCollection, withByIndex(FolderProto), withByName(FolderProto)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function getNotesApp(delegate: Delegate): Res<typeof NotesApplicationProto> {
  return createRes(delegate, NotesApplicationProto);
}

function initNotesScheme(): void {
  const jxaApp = Application('Notes');
  registerScheme('notes', () => createJXADelegate(jxaApp, 'notes'), NotesApplicationProto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────────────────────────────────

function run() {
  console.log('=== Notes.app Plugboard v4 Test ===\n');

  initNotesScheme();

  const jxaApp = Application('Notes');
  const delegate = createJXADelegate(jxaApp, 'notes');
  const notes = getNotesApp(delegate);

  // Test app-level
  console.log('App specifier:', notes.specifier().uri);
  console.log('App name:', notes.name.resolve());
  console.log('App version:', notes.version.resolve());

  console.log('\n--- Accounts ---');

  // Get accounts
  const accounts = notes.accounts.resolve();
  console.log('Account count:', accounts.length);

  if (accounts.length > 0) {
    const account0 = notes.accounts.byIndex(0);
    console.log('accounts[0] specifier:', account0.specifier().uri);
    console.log('accounts[0] name:', account0.name.resolve());

    // Get folders in account
    const folders = account0.folders.resolve();
    console.log('\n--- Folders in first account ---');
    console.log('Folder count:', folders.length);

    if (folders.length > 0) {
      const folder0 = account0.folders.byIndex(0);
      console.log('First folder specifier:', folder0.specifier().uri);
      console.log('First folder name:', folder0.name.resolve());
    }
  }

  // Test app-level notes access
  console.log('\n--- App-level Notes ---');
  const allNotes = notes.notes.resolve();
  console.log('Total notes count:', allNotes.length);

  if (allNotes.length > 0) {
    const note0 = notes.notes.byIndex(0);
    console.log('notes[0] specifier:', note0.specifier().uri);
    console.log('notes[0] name:', note0.name.resolve());
    // body can be large, skip in test
  }

  // ─────────────────────────────────────────────────────────────────────────
  // URI Resolution Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- URI Resolution Tests ---');

  // Test resolving root
  const rootResult = resolveURI('notes://');
  if (rootResult.ok) {
    console.log('Resolve notes:// -> specifier:', rootResult.value.specifier().uri);
    console.log('  name:', rootResult.value.name.resolve());
  } else {
    console.log('ERROR resolving notes://:', rootResult.error);
  }

  // Test resolving accounts[0]
  const account0Result = resolveURI('notes://accounts[0]');
  if (account0Result.ok) {
    console.log('Resolve notes://accounts[0] -> specifier:', account0Result.value.specifier().uri);
    console.log('  name:', account0Result.value.name.resolve());
  } else {
    console.log('ERROR resolving notes://accounts[0]:', account0Result.error);
  }

  // Test resolving notes[0]
  const note0Result = resolveURI('notes://notes[0]');
  if (note0Result.ok) {
    console.log('Resolve notes://notes[0] -> specifier:', note0Result.value.specifier().uri);
    console.log('  name:', note0Result.value.name.resolve());
  } else {
    console.log('ERROR resolving notes://notes[0]:', note0Result.error);
  }

  // Test error case - unknown segment
  const errorResult = resolveURI('notes://foobar');
  if (errorResult.ok) {
    console.log('Resolve notes://foobar -> unexpectedly succeeded');
  } else {
    console.log('Resolve notes://foobar -> ERROR (expected):', errorResult.error);
  }

  console.log('\n=== Notes Test Complete ===');
}

run();
