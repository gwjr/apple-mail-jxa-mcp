// Test Notes.app ONLY - proves independence from mail.ts
//
// Build: npx tsc scratch/framework.ts scratch/jxa-backing.ts scratch/notes.ts scratch/test-notes-only.ts --outFile scratch/test-notes-only.js --target ES2020 --module None --lib ES2020 --strict
// Run: osascript -l JavaScript scratch/test-notes-only.js
//
// NOTE: mail.ts is NOT in this build!

declare function Application(name: string): any;
declare var console: { log(...args: any[]): void };

function run() {
  console.log('=== Notes.app ONLY Test (no mail.ts) ===\n');

  // Initialize notes scheme
  const jxaApp = Application('Notes');
  registerScheme('notes', () => createJXADelegate(jxaApp, 'notes'), NotesApplicationProto);

  const delegate = createJXADelegate(jxaApp, 'notes');
  const notes = getNotesApp(delegate);

  // Test app-level
  console.log('App specifier:', notes.specifier().uri);
  console.log('App name:', notes.name.resolve());
  console.log('App version:', notes.version.resolve());

  console.log('\n--- Accounts ---');
  const accounts = notes.accounts.resolve();
  console.log('Account count:', accounts.length);

  if (accounts.length > 0) {
    const account0 = notes.accounts.byIndex(0);
    console.log('accounts[0] specifier:', account0.specifier().uri);
    console.log('accounts[0] name:', account0.name.resolve());
  }

  console.log('\n--- Notes ---');
  const allNotes = notes.notes.resolve();
  console.log('Total notes count:', allNotes.length);

  if (allNotes.length > 0) {
    const note0 = notes.notes.byIndex(0);
    console.log('notes[0] specifier:', note0.specifier().uri);
    console.log('notes[0] name:', note0.name.resolve());
  }

  console.log('\n--- URI Resolution ---');

  const rootResult = resolveURI('notes://');
  if (rootResult.ok) {
    console.log('Resolve notes:// -> name:', rootResult.value.name.resolve());
  } else {
    console.log('ERROR:', rootResult.error);
  }

  const accountResult = resolveURI('notes://accounts[0]');
  if (accountResult.ok) {
    console.log('Resolve notes://accounts[0] -> name:', accountResult.value.name.resolve());
  } else {
    console.log('ERROR:', accountResult.error);
  }

  // Prove mail:// is NOT registered (mail.ts not included)
  const mailResult = resolveURI('mail://');
  if (mailResult.ok) {
    console.log('ERROR: mail:// should NOT be available!');
  } else {
    console.log('mail:// correctly unavailable:', mailResult.error);
  }

  console.log('\n=== Notes ONLY Test Complete ===');
}

run();
