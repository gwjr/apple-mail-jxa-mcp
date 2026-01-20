"use strict";
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
// ============================================================================
// Declarative JXA Schema Framework
// ============================================================================
// ============================================================================
// Helpers
// ============================================================================
function str(val) {
    return val == null ? '' : '' + val;
}
function tryResolve(fn, context) {
    try {
        return { ok: true, value: fn() };
    }
    catch (e) {
        return { ok: false, error: `${context}: ${e}` };
    }
}
// Registry of root specifier factories by scheme
const schemeRoots = {};
function registerScheme(scheme, root) {
    schemeRoots[scheme] = root;
}
// Deserialize a URI into a specifier
function specifierFromURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return { ok: false, error: `Invalid URI (no scheme): ${uri}` };
    }
    const scheme = uri.slice(0, schemeEnd);
    let rest = uri.slice(schemeEnd + 3);
    // Separate query string
    let query;
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        query = rest.slice(queryIdx + 1);
        rest = rest.slice(0, queryIdx);
    }
    const rootFactory = schemeRoots[scheme];
    if (!rootFactory) {
        return { ok: false, error: `Unknown scheme: ${scheme}` };
    }
    let current = rootFactory();
    let resolved = `${scheme}://`;
    for (const segment of rest.split('/').filter(s => s)) {
        const indexMatch = segment.match(/^(.+?)\[(\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        try {
            // Property access or element access?
            if (current[name] !== undefined) {
                current = current[name];
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else if (current.byName) {
                current = current.byName(decodeURIComponent(name));
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else if (current.byId) {
                current = current.byId(decodeURIComponent(name));
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else {
                return { ok: false, error: `Cannot navigate to '${name}' (resolved: ${resolved})` };
            }
            // Apply index if present
            if (index !== undefined) {
                if (!current.byIndex) {
                    return { ok: false, error: `Cannot index into '${name}' (resolved: ${resolved})` };
                }
                current = current.byIndex(index);
                resolved += `[${index}]`;
            }
        }
        catch (e) {
            return { ok: false, error: `Failed at '${segment}': ${e} (resolved: ${resolved})` };
        }
    }
    // Apply whose filter and sort if present
    if (query) {
        try {
            const { filter, sort } = parseQuery(query);
            if (Object.keys(filter).length > 0 && current.whose) {
                current = current.whose(filter);
            }
            if (sort && current.sortBy) {
                current = current.sortBy(sort);
            }
            resolved += '?' + query;
        }
        catch (e) {
            return { ok: false, error: `Failed to apply query: ${e} (resolved: ${resolved})` };
        }
    }
    return { ok: true, value: current };
}
// ============================================================================
// Helper Functions for Schema Definition
// ============================================================================
function accessor(jxaName) {
    return {
        _accessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function lazyAccessor(jxaName) {
    return {
        _lazyAccessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function collection(jxaName, elementBase, addressing) {
    return {
        _collection: true,
        _elementBase: elementBase,
        _jxaName: jxaName,
        _addressing: addressing
    };
}
// ============================================================================
// Runtime Implementation Factory
// ============================================================================
function createDerived(schema, typeName) {
    class DerivedClass {
        _jxa;
        _uri;
        constructor(_jxa, _uri) {
            this._jxa = _jxa;
            this._uri = _uri;
            this._initializeProperties();
        }
        static fromJXA(_jxa, _uri) {
            return new DerivedClass(_jxa, _uri);
        }
        _initializeProperties() {
            for (const [key, descriptor] of Object.entries(schema)) {
                if (this._isAccessor(descriptor)) {
                    this._defineAccessorProperty(key, descriptor);
                }
                else if (this._isLazyAccessor(descriptor)) {
                    this._defineLazyAccessorProperty(key, descriptor);
                }
                else if (this._isCollection(descriptor)) {
                    this._defineCollectionProperty(key, descriptor);
                }
            }
        }
        _isAccessor(desc) {
            return desc && desc._accessor === true;
        }
        _isLazyAccessor(desc) {
            return desc && desc._lazyAccessor === true;
        }
        _isCollection(desc) {
            return desc && desc._collection === true;
        }
        _defineAccessorProperty(key, descriptor) {
            Object.defineProperty(this, key, {
                get() {
                    const value = this._jxa[descriptor._jxaName]();
                    return this._convertValue(value);
                },
                enumerable: true
            });
        }
        _defineLazyAccessorProperty(key, descriptor) {
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
        _defineCollectionProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    const jxaCollection = self._jxa[descriptor._jxaName];
                    const base = self._uri || `${typeName.toLowerCase()}://`;
                    const uri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
                    return createCollectionSpecifier(uri, jxaCollection, descriptor._elementBase, descriptor._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
        _convertValue(value) {
            if (value == null)
                return '';
            if (Array.isArray(value))
                return value.map(v => this._convertValue(v));
            return value;
        }
    }
    return DerivedClass;
}
// ============================================================================
// Specifier Factories
// ============================================================================
// Helper for scalar specifiers
function scalarSpecifier(uri, getValue) {
    return {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(getValue, uri);
        }
    };
}
// Element specifier factory
function createElementSpecifier(uri, jxa, schema, typeName) {
    const ElementClass = createDerived(schema, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => ElementClass.fromJXA(jxa, uri), uri);
        }
    };
    // Add lifted property specifiers
    for (const [key, descriptor] of Object.entries(schema)) {
        if ('_accessor' in descriptor || '_lazyAccessor' in descriptor) {
            // Both accessor and lazyAccessor lift to Specifier<T> on a Specifier
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxa[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxa[desc._jxaName], desc._elementBase, desc._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Collection specifier factory
function createCollectionSpecifier(uri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter) {
    const ElementClass = createDerived(elementBase, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => {
                const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
                let results = jxaArray.map((jxa, i) => ElementClass.fromJXA(jxa, `${uri}[${i}]`));
                // Apply JS filter if specified
                if (jsFilter && Object.keys(jsFilter).length > 0) {
                    results = results.filter((item) => {
                        for (const [key, predicate] of Object.entries(jsFilter)) {
                            const val = item[key];
                            const pred = predicate;
                            if ('contains' in pred && typeof val === 'string' && !val.includes(pred.contains))
                                return false;
                            if ('startsWith' in pred && typeof val === 'string' && !val.startsWith(pred.startsWith))
                                return false;
                            if ('greaterThan' in pred && !(val > pred.greaterThan))
                                return false;
                            if ('lessThan' in pred && !(val < pred.lessThan))
                                return false;
                            if ('equals' in pred && val !== pred.equals)
                                return false;
                        }
                        return true;
                    });
                }
                // Apply sort if specified
                if (sortSpec) {
                    results.sort((a, b) => {
                        const aVal = a[sortSpec.by];
                        const bVal = b[sortSpec.by];
                        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                        return sortSpec.direction === 'desc' ? -cmp : cmp;
                    });
                }
                return results;
            }, uri);
        }
    };
    // Add addressing methods
    if (addressing.includes('index')) {
        spec.byIndex = function (i) {
            return createElementSpecifier(`${uri}[${i}]`, jxaCollection.at(i), elementBase, typeName);
        };
    }
    if (addressing.includes('name')) {
        spec.byName = function (name) {
            return createElementSpecifier(`${uri}/${encodeURIComponent(name)}`, jxaCollection.byName(name), elementBase, typeName);
        };
    }
    if (addressing.includes('id')) {
        spec.byId = function (id) {
            return createElementSpecifier(`${uri}/${id}`, jxaCollection.byId(id), elementBase, typeName);
        };
    }
    // Add whose filtering
    spec.whose = function (filter) {
        const filteredUri = `${uri}?${encodeFilter(filter)}`;
        // Build JXA whose clause
        const jxaFilter = {};
        for (const [key, predicate] of Object.entries(filter)) {
            const descriptor = elementBase[key];
            if (!descriptor || !('_jxaName' in descriptor)) {
                throw new Error(`Unknown property: ${key}`);
            }
            const jxaName = descriptor._jxaName;
            const pred = predicate;
            if ('equals' in pred) {
                jxaFilter[jxaName] = pred.equals;
            }
            else if ('contains' in pred) {
                jxaFilter[jxaName] = { _contains: pred.contains };
            }
            else if ('startsWith' in pred) {
                jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
            }
            else if ('greaterThan' in pred) {
                jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
            }
            else if ('lessThan' in pred) {
                jxaFilter[jxaName] = { _lessThan: pred.lessThan };
            }
        }
        // Try JXA whose first, fall back to JS filter
        try {
            const filteredJXA = jxaCollection.whose(jxaFilter);
            // Test if it works by accessing length (triggers evaluation)
            void filteredJXA.length;
            return createCollectionSpecifier(filteredUri, filteredJXA, elementBase, addressing, typeName, sortSpec);
        }
        catch {
            // JXA filter failed, use JS post-filter
            return createCollectionSpecifier(filteredUri, jxaCollection, elementBase, addressing, typeName, sortSpec, filter);
        }
    };
    // Add sortBy
    spec.sortBy = function (newSortSpec) {
        const sep = uri.includes('?') ? '&' : '?';
        const sortedUri = `${uri}${sep}sort=${String(newSortSpec.by)}.${newSortSpec.direction || 'asc'}`;
        return createCollectionSpecifier(sortedUri, jxaCollection, elementBase, addressing, typeName, newSortSpec, jsFilter);
    };
    return spec;
}
// ============================================================================
// Filter Encoding/Decoding
// ============================================================================
function encodeFilter(filter) {
    const parts = [];
    for (const [key, predicate] of Object.entries(filter)) {
        const pred = predicate;
        if ('equals' in pred) {
            parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
        }
        else if ('contains' in pred) {
            parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
        }
        else if ('startsWith' in pred) {
            parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
        }
        else if ('greaterThan' in pred) {
            parts.push(`${key}.gt=${pred.greaterThan}`);
        }
        else if ('lessThan' in pred) {
            parts.push(`${key}.lt=${pred.lessThan}`);
        }
    }
    return parts.join('&');
}
function parseQuery(query) {
    const result = { filter: {} };
    for (const part of query.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = part.slice(eqIdx + 1);
        // Handle sort parameter
        if (key === 'sort') {
            const [by, direction] = value.split('.');
            result.sort = { by, direction: direction || 'asc' };
            continue;
        }
        // Handle filter parameters
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            result.filter[key] = { equals: decodeURIComponent(value) };
        }
        else {
            const prop = key.slice(0, dotIdx);
            const op = key.slice(dotIdx + 1);
            if (op === 'contains') {
                result.filter[prop] = { contains: decodeURIComponent(value) };
            }
            else if (op === 'startsWith') {
                result.filter[prop] = { startsWith: decodeURIComponent(value) };
            }
            else if (op === 'gt') {
                result.filter[prop] = { greaterThan: Number(value) };
            }
            else if (op === 'lt') {
                result.filter[prop] = { lessThan: Number(value) };
            }
        }
    }
    return result;
}
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
// ============================================================================
// Apple Mail Schema Definitions
// ============================================================================
const RecipientBase = {
    name: accessor('name'),
    address: accessor('address'),
};
const AttachmentBase = {
    id: accessor('id'),
    name: accessor('name'),
    fileSize: accessor('fileSize'),
};
const MessageBase = {
    id: accessor('id'),
    messageId: accessor('messageId'),
    subject: accessor('subject'),
    sender: accessor('sender'),
    replyTo: accessor('replyTo'),
    dateSent: accessor('dateSent'),
    dateReceived: accessor('dateReceived'),
    content: lazyAccessor('content'), // lazy - expensive to fetch
    readStatus: accessor('readStatus'),
    flaggedStatus: accessor('flaggedStatus'),
    junkMailStatus: accessor('junkMailStatus'),
    messageSize: accessor('messageSize'),
    toRecipients: collection('toRecipients', RecipientBase, ['name', 'index']),
    ccRecipients: collection('ccRecipients', RecipientBase, ['name', 'index']),
    bccRecipients: collection('bccRecipients', RecipientBase, ['name', 'index']),
    attachments: collection('mailAttachments', AttachmentBase, ['name', 'index', 'id']),
};
const MailboxBase = {
    name: accessor('name'),
    unreadCount: accessor('unreadCount'),
    messages: collection('messages', MessageBase, ['index', 'id'])
};
// Self-referential: mailboxes contain mailboxes
MailboxBase.mailboxes = collection('mailboxes', MailboxBase, ['name', 'index']);
const AccountBase = {
    id: accessor('id'),
    name: accessor('name'),
    fullName: accessor('fullName'),
    emailAddresses: accessor('emailAddresses'),
    mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'])
};
const MailAppBase = {
    accounts: collection('accounts', AccountBase, ['name', 'index', 'id'])
};
// ============================================================================
// Create Derived Types
// ============================================================================
const Recipient = createDerived(RecipientBase, 'Recipient');
const Attachment = createDerived(AttachmentBase, 'Attachment');
const Message = createDerived(MessageBase, 'Message');
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');
// ============================================================================
// Entry Point
// ============================================================================
const MailApp = createDerived(MailAppBase, 'Mail');
// Lazily initialized app specifier
let _mailApp = null;
function getMailApp() {
    if (!_mailApp) {
        const jxa = Application('Mail');
        const app = MailApp.fromJXA(jxa, 'mail://');
        // Add specifier-like properties
        app.uri = 'mail://';
        app._isSpecifier = true;
        app.resolve = () => ({ ok: true, value: app });
        _mailApp = app;
    }
    return _mailApp;
}
// Register mail:// scheme
registerScheme('mail', getMailApp);
// Export for JXA
globalThis.specifierFromURI = specifierFromURI;
/// <reference path="./types/mcp.d.ts" />
// ============================================================================
// MCP Resource Handler
// ============================================================================
function readResource(uri) {
    const spec = specifierFromURI(uri);
    if (!spec.ok) {
        return { mimeType: 'text/plain', text: spec.error };
    }
    const result = spec.value.resolve();
    if (!result.ok) {
        return { mimeType: 'text/plain', text: result.error };
    }
    return { mimeType: 'application/json', text: result.value };
}
function listResources() {
    const resources = [
        { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' }
    ];
    const spec = specifierFromURI('mail://accounts');
    if (spec.ok) {
        const result = spec.value.resolve();
        if (result.ok) {
            for (let i = 0; i < result.value.length; i++) {
                const acc = result.value[i];
                resources.push({
                    uri: `mail://accounts[${i}]`,
                    name: acc.name,
                    description: `Account: ${acc.fullName}`
                });
            }
        }
    }
    return resources;
}
const resourceTemplates = [
    { uriTemplate: 'mail://accounts[{index}]', name: 'Account', description: 'Mail account by index' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes', name: 'Mailboxes', description: 'Mailboxes for an account' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes?{filter}', name: 'Filtered Mailboxes', description: 'Filter: ?name=X, ?unreadCount.gt=0. Sort: ?sort=name.asc' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}', name: 'Mailbox', description: 'Mailbox by name (can be nested: /mailboxes/A/mailboxes/B)' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages', name: 'Messages', description: 'Messages in a mailbox' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages?{filter}', name: 'Filtered Messages', description: 'Filter: ?readStatus=false. Sort: ?sort=dateReceived.desc' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages[{msgIndex}]', name: 'Message', description: 'Single message by index' },
    { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}', name: 'Message', description: 'Single message by id' }
];
// Export for JXA
globalThis.readResource = readResource;
globalThis.listResources = listResources;
globalThis.resourceTemplates = resourceTemplates;
