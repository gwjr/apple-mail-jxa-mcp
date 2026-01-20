/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Rules Resource Handler
// Returns mail rules list or individual rule details
// ============================================================================

interface RuleConditionInfo {
  header: string | null;
  qualifier: string | null;
  ruleType: string | null;
  expression: string | null;
}

interface RuleSummary {
  uri: string;
  name: string;
  enabled: boolean;
}

interface RuleDetails {
  index: number;
  name: string | null;
  enabled: boolean | null;
  allConditionsMustBeMet: boolean | null;
  copyMessage: string | null;
  moveMessage: string | null;
  forwardMessage: string | null;
  redirectMessage: string | null;
  replyText: string | null;
  runScript: string | null;
  highlightTextUsingColor: string | null;
  deleteMessage: boolean | null;
  markFlagged: boolean | null;
  markFlagIndex: number | null;
  markRead: boolean | null;
  playSound: string | null;
  stopEvaluatingRules: boolean | null;
  ruleConditions: RuleConditionInfo[];
}

interface RulesListResponse {
  count: number;
  rules: RuleSummary[];
}

function readRulesList(): { mimeType: string; text: RulesListResponse } {
  const rules = Mail.getRules();

  return {
    mimeType: 'application/json',
    text: {
      count: rules.length,
      rules: rules.map((r, i) => ({
        uri: URIBuilder.rules(i),
        name: getOr(() => r.name(), ''),
        enabled: getOr(() => r.enabled(), false)
      }))
    }
  };
}

function readRule(index: number): { mimeType: string; text: RuleDetails } | null {
  const rules = Mail.getRules();

  if (index < 0 || index >= rules.length) {
    return null;
  }

  const r = rules[index];

  let conditions: RuleConditionInfo[] = [];
  try {
    const rawConditions = r.ruleConditions();
    conditions = rawConditions.map(c => ({
      header: getOr(() => c.header(), null),
      qualifier: getOr(() => c.qualifier(), null),
      ruleType: getOr(() => c.ruleType(), null),
      expression: getOr(() => c.expression(), null)
    }));
  } catch {
    // Ignore condition read errors
  }

  return {
    mimeType: 'application/json',
    text: {
      index,
      name: getOr(() => r.name(), null),
      enabled: getOr(() => r.enabled(), null),
      allConditionsMustBeMet: getOr(() => r.allConditionsMustBeMet(), null),
      copyMessage: getOr(() => { const mb = r.copyMessage(); return mb ? mb.name() : null; }, null),
      moveMessage: getOr(() => { const mb = r.moveMessage(); return mb ? mb.name() : null; }, null),
      forwardMessage: getOr(() => r.forwardMessage(), null),
      redirectMessage: getOr(() => r.redirectMessage(), null),
      replyText: getOr(() => r.replyText(), null),
      runScript: getOr(() => { const s = r.runScript(); return s && s.name ? s.name() : null; }, null),
      highlightTextUsingColor: getOr(() => r.highlightTextUsingColor(), null),
      deleteMessage: getOr(() => r.deleteMessage(), null),
      markFlagged: getOr(() => r.markFlagged(), null),
      markFlagIndex: getOr(() => r.markFlagIndex(), null),
      markRead: getOr(() => r.markRead(), null),
      playSound: getOr(() => r.playSound(), null),
      stopEvaluatingRules: getOr(() => r.stopEvaluatingRules(), null),
      ruleConditions: conditions
    }
  };
}
