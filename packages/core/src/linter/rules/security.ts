// ============================================================
// Security & Governance Rules (15 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type { FlowMLDocument } from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';

const systemModeUndocumented: LintRule = {
  id: 'system-mode-undocumented',
  severity: 'info',
  category: 'security',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    const mode = doc.flow.runInMode;
    if (!mode) return [];
    const isSystemMode = mode.toLowerCase().includes('system');
    if (!isSystemMode) return [];

    const desc = (doc.flow.description ?? '').toLowerCase();
    const mentionsSecurity = desc.includes('system') || desc.includes('sharing') ||
      desc.includes('permission') || desc.includes('elevated');
    if (mentionsSecurity) return [];

    return [{
      ruleId: 'system-mode-undocumented',
      severity: 'info',
      category: 'security',
      message: `Flow runs in ${mode} but description does not document the security justification`,
      deduction: 3,
    }];
  },
};

const apiVersionOutdated: LintRule = {
  id: 'api-version-outdated',
  severity: 'warning',
  category: 'security',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    const version = parseFloat(doc.flow.apiVersion);
    if (isNaN(version)) return [];
    if (version < 62.0) {
      return [{
        ruleId: 'api-version-outdated',
        severity: 'warning',
        category: 'security',
        message: `API version ${doc.flow.apiVersion} is outdated — update to 62.0+ for latest features`,
        deduction: 5,
      }];
    }
    return [];
  },
};

const scheduledFlowActive: LintRule = {
  id: 'scheduled-flow-active',
  severity: 'info',
  category: 'security',
  maxDeduction: 0,
  check(doc: FlowMLDocument): LintResult[] {
    if (!doc.trigger) return [];
    const isScheduled = doc.trigger.type === 'Scheduled' ||
      doc.trigger.schedule !== undefined;
    if (!isScheduled) return [];
    if (doc.flow.status !== 'Active') return [];

    return [{
      ruleId: 'scheduled-flow-active',
      severity: 'info',
      category: 'security',
      message: 'Active scheduled flow — runs automatically without user interaction',
      deduction: 0,
    }];
  },
};

export const securityRules: LintRule[] = [
  systemModeUndocumented,
  apiVersionOutdated,
  scheduledFlowActive,
];
