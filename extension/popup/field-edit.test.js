require('./test-support/popup-env');
const { resolveEditedField, isRenameLocked, hasEditableTransforms, openFieldEditPatch, applyFieldEdit, derivedEditAvailableNames, derivedEditScope, applyDerivedFieldEdit } = require('./field-edit');

const combine = { kind: 'combineFields', sourceFieldNames: ['Vorname', 'Nachname'], separator: ' ' };
const split = { kind: 'splitField', sourceFieldName: 'Adresse', separator: ',', index: 0 };

const flatState = () => ({
  fields: [
    { name: 'Vorname', selector: '.first', transforms: [{ kind: 'trim' }], sampleValue: '  Anna ' },
    { name: 'Nachname', selector: '.last', transforms: null },
    { name: 'Voller Name', selector: null, transforms: [combine] },
  ],
  groups: [],
});

const containerState = () => ({
  fields: [],
  groups: [{
    kind: 'group', name: 'Gericht', selector: '.dish', repeating: true, framePath: null,
    children: [
      { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', transforms: [{ kind: 'toNumber' }], sampleValue: '12,50 €' },
      { kind: 'field', name: 'Vorhanden', selector: '.badge', mode: 'exists', transforms: null },
      { kind: 'field', name: 'Teil', selector: null, mode: 'text', transforms: [split] },
      { kind: 'group', name: 'Zutaten', selector: '.ing', repeating: false, framePath: null, children: [] },
    ],
  }],
});

describe('resolveEditedField', () => {
  test('finds a flat field by index and a container field by path', () => {
    expect(resolveEditedField(flatState(), { mode: 'flat', index: 1 }).name).toBe('Nachname');
    expect(resolveEditedField(containerState(), { mode: 'container', path: [0, 0] }).name).toBe('Preis');
  });

  test('a stale index or a group path resolves to nothing', () => {
    expect(resolveEditedField(flatState(), { mode: 'flat', index: 9 })).toBeNull();
    expect(resolveEditedField(containerState(), { mode: 'container', path: [0, 3] })).toBeNull();
  });
});

describe('openFieldEditPatch', () => {
  test('loads a copy of the chain and the stored sample', () => {
    const state = flatState();
    const patch = openFieldEditPatch(state, { mode: 'flat', index: 0 });
    expect(patch).toMatchObject({ editingField: { mode: 'flat', index: 0 }, pendingTransforms: [{ kind: 'trim' }], pendingRawText: '  Anna ' });
    expect(patch.pendingTransforms).not.toBe(state.fields[0].transforms);
  });

  test('a field without a chain or sample starts empty (no preview)', () => {
    expect(openFieldEditPatch(flatState(), { mode: 'flat', index: 1 })).toMatchObject({ pendingTransforms: [], pendingRawText: null });
  });
});

describe('applyFieldEdit', () => {
  test('replaces name and chain of a flat field in place', () => {
    const state = flatState();
    const patch = applyFieldEdit(state, { mode: 'flat', index: 1 }, 'Familienname', [{ kind: 'trim' }]);
    expect(patch.fields.map(f => f.name)).toEqual(['Vorname', 'Familienname', 'Voller Name']);
    expect(patch.fields[1]).toMatchObject({ selector: '.last', transforms: [{ kind: 'trim' }] });
    expect(state.fields[1].transforms).toBeNull();
  });

  test('an emptied chain becomes null, like a field created without one', () => {
    const patch = applyFieldEdit(flatState(), { mode: 'flat', index: 0 }, 'Vorname', []);
    expect(patch.fields[0].transforms).toBeNull();
  });

  test('edits a container field in place and leaves its siblings alone', () => {
    const patch = applyFieldEdit(containerState(), { mode: 'container', path: [0, 0] }, 'Preis EUR', [{ kind: 'toNumber' }, { kind: 'trim' }]);
    const children = patch.groups[0].children;
    expect(children[0]).toMatchObject({ name: 'Preis EUR', selector: '.price', transforms: [{ kind: 'toNumber' }, { kind: 'trim' }] });
    expect(children.map(c => c.name)).toEqual(['Preis EUR', 'Vorhanden', 'Teil', 'Zutaten']);
  });

  test('an "exists" field has no chain: only its name changes', () => {
    const patch = applyFieldEdit(containerState(), { mode: 'container', path: [0, 1] }, 'Da?', [{ kind: 'trim' }]);
    expect(patch.groups[0].children[1]).toMatchObject({ name: 'Da?', transforms: null });
  });
});

describe('isRenameLocked / hasEditableTransforms', () => {
  test('a source of a combine field cannot be renamed, an unrelated field can', () => {
    const state = flatState();
    expect(isRenameLocked(state, { mode: 'flat', index: 0 })).toBe(true);
    expect(isRenameLocked(state, { mode: 'flat', index: 1 })).toBe(true);
    expect(isRenameLocked(state, { mode: 'flat', index: 2 })).toBe(false);
  });

  test('in a container only siblings of the same group count', () => {
    const state = containerState();
    state.groups[0].children.splice(0, 0, { kind: 'field', name: 'Adresse', selector: '.addr', mode: 'text', transforms: null });
    expect(isRenameLocked(state, { mode: 'container', path: [0, 0] })).toBe(true); // 'Adresse' feeds 'Teil'
    expect(isRenameLocked(state, { mode: 'container', path: [0, 1] })).toBe(false);
  });

  test('derived and "exists" fields offer no chain editor', () => {
    expect(hasEditableTransforms(flatState().fields[2])).toBe(false);
    expect(hasEditableTransforms(containerState().groups[0].children[1])).toBe(false);
    expect(hasEditableTransforms(flatState().fields[0])).toBe(true);
  });
});

describe('derived field edits', () => {
  test('only the fields before the edited one are offered as sources', () => {
    expect(derivedEditAvailableNames(flatState(), { mode: 'flat', index: 2 })).toEqual(['Vorname', 'Nachname']);
    expect(derivedEditAvailableNames(containerState(), { mode: 'container', path: [0, 2] })).toEqual(['Preis', 'Vorhanden']);
  });

  test('the scope is the edited field\'s own list', () => {
    expect(derivedEditScope({ mode: 'flat', index: 2 })).toEqual({ mode: 'flat' });
    expect(derivedEditScope({ mode: 'container', path: [0, 2] })).toEqual({ mode: 'container', parentPath: [0] });
    expect(derivedEditScope({ mode: 'container', path: [1] })).toEqual({ mode: 'container', parentPath: null });
  });

  test('replaces name and transform in place', () => {
    const next = { kind: 'combineFields', sourceFieldNames: ['Nachname', 'Vorname'], separator: ', ' };
    const patch = applyDerivedFieldEdit(flatState(), { mode: 'flat', index: 2 }, 'Name', next);
    expect(patch.fields[2]).toMatchObject({ name: 'Name', selector: null, transforms: [next] });
  });
});
