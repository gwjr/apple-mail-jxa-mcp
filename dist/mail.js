"use strict";
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
// ============================================================================
// Proof of Concept: Declarative JXA Schema System
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
                    const uri = self._uri
                        ? `${self._uri}/${key}`
                        : `${typeName.toLowerCase()}://.../${key}`;
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
function createCollectionSpecifier(uri, jxaCollection, elementBase, addressing, typeName) {
    const ElementClass = createDerived(elementBase, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => {
                const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
                return jxaArray.map((jxa, i) => ElementClass.fromJXA(jxa, `${uri}[${i}]`));
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
    return spec;
}
// ============================================================================
// Schema Definitions
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
const AccountBase = {
    id: accessor('id'),
    name: accessor('name'),
    fullName: accessor('fullName'),
    emailAddresses: accessor('emailAddresses'),
    mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'])
};
// ============================================================================
// Create Derived Types
// ============================================================================
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');
// ============================================================================
// Entry Point
// ============================================================================
var Mail = {
    _app: null,
    get app() {
        if (!this._app) {
            const app = Application('Mail');
            if (typeof app.accounts === 'undefined') {
                throw new Error('Not connected to Mail.app');
            }
            this._app = app;
        }
        return this._app;
    },
    accounts() {
        return createCollectionSpecifier('mail://accounts', this.app.accounts, AccountBase, ['name', 'index', 'id'], 'Account');
    }
};
// Export for JXA
globalThis.Mail = Mail;
