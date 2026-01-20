/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Properties Resource Handler
// Returns Mail.app properties and settings
// ============================================================================

interface AppProperties {
  name: string | null;
  version: string | null;
  applicationVersion: string | null;
  frontmost: boolean | null;
  alwaysBccMyself: boolean | null;
  alwaysCcMyself: boolean | null;
  downloadHtmlAttachments: boolean | null;
  fetchInterval: number | null;
  expandGroupAddresses: boolean | null;
  defaultMessageFormat: string | null;
  chooseSignatureWhenComposing: boolean | null;
  selectedSignature: string | null;
  quoteOriginalMessage: boolean | null;
  sameReplyFormat: boolean | null;
  includeAllOriginalMessageText: boolean | null;
  highlightSelectedConversation: boolean | null;
  colorQuotedText: boolean | null;
  levelOneQuotingColor: string | null;
  levelTwoQuotingColor: string | null;
  levelThreeQuotingColor: string | null;
  messageFont: string | null;
  messageFontSize: number | null;
  messageListFont: string | null;
  messageListFontSize: number | null;
  useFixedWidthFont: boolean | null;
  fixedWidthFont: string | null;
  fixedWidthFontSize: number | null;
  newMailSound: string | null;
  shouldPlayOtherMailSounds: boolean | null;
  checkSpellingWhileTyping: boolean | null;
}

function readProperties(): { mimeType: string; text: AppProperties } {
  const app = Mail.app;

  return {
    mimeType: 'application/json',
    text: {
      name: getOr(() => app.name(), null),
      version: getOr(() => app.version(), null),
      applicationVersion: getOr(() => app.applicationVersion(), null),
      frontmost: getOr(() => app.frontmost(), null),
      alwaysBccMyself: getOr(() => app.alwaysBccMyself(), null),
      alwaysCcMyself: getOr(() => app.alwaysCcMyself(), null),
      downloadHtmlAttachments: getOr(() => app.downloadHtmlAttachments(), null),
      fetchInterval: getOr(() => app.fetchInterval(), null),
      expandGroupAddresses: getOr(() => app.expandGroupAddresses(), null),
      defaultMessageFormat: getOr(() => app.defaultMessageFormat(), null),
      chooseSignatureWhenComposing: getOr(() => app.chooseSignatureWhenComposing(), null),
      selectedSignature: getOr(() => { const sig = app.selectedSignature(); return sig ? sig.name() : null; }, null),
      quoteOriginalMessage: getOr(() => app.quoteOriginalMessage(), null),
      sameReplyFormat: getOr(() => app.sameReplyFormat(), null),
      includeAllOriginalMessageText: getOr(() => app.includeAllOriginalMessageText(), null),
      highlightSelectedConversation: getOr(() => app.highlightSelectedConversation(), null),
      colorQuotedText: getOr(() => app.colorQuotedText(), null),
      levelOneQuotingColor: getOr(() => app.levelOneQuotingColor(), null),
      levelTwoQuotingColor: getOr(() => app.levelTwoQuotingColor(), null),
      levelThreeQuotingColor: getOr(() => app.levelThreeQuotingColor(), null),
      messageFont: getOr(() => app.messageFont(), null),
      messageFontSize: getOr(() => app.messageFontSize(), null),
      messageListFont: getOr(() => app.messageListFont(), null),
      messageListFontSize: getOr(() => app.messageListFontSize(), null),
      useFixedWidthFont: getOr(() => app.useFixedWidthFont(), null),
      fixedWidthFont: getOr(() => app.fixedWidthFont(), null),
      fixedWidthFontSize: getOr(() => app.fixedWidthFontSize(), null),
      newMailSound: getOr(() => app.newMailSound(), null),
      shouldPlayOtherMailSounds: getOr(() => app.shouldPlayOtherMailSounds(), null),
      checkSpellingWhileTyping: getOr(() => app.checkSpellingWhileTyping(), null)
    }
  };
}
