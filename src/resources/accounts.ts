/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Accounts Resource Handler
// Returns mail accounts list or individual account details
// ============================================================================

interface AccountSummary {
  name: string;
  uri: string;
  mailboxesUri: string;
}

interface AccountDetails {
  name: string;
  uri: string;
  mailboxesUri: string;
  emailAddresses: string[];
  enabled: boolean;
  fullName: string;
}

interface AccountsListResponse {
  accounts: AccountSummary[];
}

function readAccountsList(): { mimeType: string; text: AccountsListResponse } {
  const accounts = Mail.getAccounts();

  return {
    mimeType: 'application/json',
    text: {
      accounts: accounts.map(acc => ({
        name: acc.name,
        uri: URIBuilder.account(acc.name),
        mailboxesUri: URIBuilder.accountMailboxes(acc.name)
      }))
    }
  };
}

function readAccount(accountName: string): { mimeType: string; text: AccountDetails } | null {
  const account = Mail.getAccount(accountName);

  if (!account) {
    return null;
  }

  return {
    mimeType: 'application/json',
    text: {
      name: account.name,
      uri: URIBuilder.account(account.name),
      mailboxesUri: URIBuilder.accountMailboxes(account.name),
      emailAddresses: account.emailAddresses,
      enabled: account.enabled,
      fullName: account.fullName
    }
  };
}
