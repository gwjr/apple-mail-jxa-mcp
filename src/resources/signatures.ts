/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Signatures Resource Handler
// Returns email signatures list or individual signature content
// ============================================================================

interface SignatureSummary {
  uri: string;
  name: string;
}

interface SignatureDetails {
  name: string;
  content: string;
}

interface SignaturesListResponse {
  count: number;
  signatures: SignatureSummary[];
}

function readSignaturesList(): { mimeType: string; text: SignaturesListResponse } {
  const signatures = Mail.getSignatures();

  return {
    mimeType: 'application/json',
    text: {
      count: signatures.length,
      signatures: signatures.map(s => ({
        uri: URIBuilder.signatures(getOr(() => s.name(), '')),
        name: getOr(() => s.name(), '')
      }))
    }
  };
}

function readSignature(name: string): { mimeType: string; text: SignatureDetails } | null {
  const signatures = Mail.getSignatures();
  const sig = signatures.find(s => getOr(() => s.name(), '') === name);

  if (!sig) {
    return null;
  }

  return {
    mimeType: 'application/json',
    text: {
      name: getOr(() => sig.name(), ''),
      content: getOr(() => sig.content(), '')
    }
  };
}
