// scratch/notes.ts - Notes.app Schema
//
// Uses framework.ts building blocks. No framework code here.

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

// Folder proto (recursive)
interface NotesFolderProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  id: typeof eagerScalar;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
  folders: BaseProtoType & ByIndexProto<NotesFolderProtoType> & ByNameProto<NotesFolderProtoType>;
}

const NotesFolderProto: NotesFolderProtoType = {
  ...baseScalar,
  name: eagerScalar,
  id: eagerScalar,
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
  folders: null as any,
};

NotesFolderProto.folders = pipe2(baseCollection, withByIndex(NotesFolderProto), withByName(NotesFolderProto));

// Account proto
interface NotesAccountProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  id: typeof eagerScalar;
  folders: BaseProtoType & ByIndexProto<typeof NotesFolderProto> & ByNameProto<typeof NotesFolderProto>;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
}

const NotesAccountProto: NotesAccountProtoType = {
  ...baseScalar,
  name: eagerScalar,
  id: eagerScalar,
  folders: pipe2(baseCollection, withByIndex(NotesFolderProto), withByName(NotesFolderProto)),
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
};

// Application proto
interface NotesApplicationProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  version: typeof eagerScalar;
  accounts: BaseProtoType & ByIndexProto<typeof NotesAccountProto> & ByNameProto<typeof NotesAccountProto>;
  notes: BaseProtoType & ByIndexProto<typeof LazyNoteProto> & ByIdProto<typeof LazyNoteProto>;
  folders: BaseProtoType & ByIndexProto<typeof NotesFolderProto> & ByNameProto<typeof NotesFolderProto>;
}

const NotesApplicationProto: NotesApplicationProtoType = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe2(baseCollection, withByIndex(NotesAccountProto), withByName(NotesAccountProto)),
  notes: pipe2(baseCollection, withByIndex(LazyNoteProto), withById(LazyNoteProto)),
  folders: pipe2(baseCollection, withByIndex(NotesFolderProto), withByName(NotesFolderProto)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function getNotesApp(delegate: Delegate): Res<typeof NotesApplicationProto> {
  return createRes(delegate, NotesApplicationProto);
}

// Type aliases
type NotesApplication = Res<typeof NotesApplicationProto>;
type NotesAccount = Res<typeof NotesAccountProto>;
type NotesFolder = Res<typeof NotesFolderProto>;
type Note = Res<typeof NoteProto>;
