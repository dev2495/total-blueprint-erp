export type HelpLocale = "en" | "hi";

export interface LocalizedText {
  en: string;
  hi: string;
}

export interface FAQItem {
  id: string;
  question: LocalizedText;
  answer: LocalizedText;
}

export interface DecisionFlowOutcome {
  label: LocalizedText;
  nextId?: string;
  resolution?: LocalizedText;
}

export interface DecisionFlowNode {
  id: string;
  title: LocalizedText;
  outcomes: DecisionFlowOutcome[];
}

export interface DecisionFlow {
  id: string;
  title: LocalizedText;
  nodes: DecisionFlowNode[];
}

export interface RoleGuide {
  roleCode: string;
  title: LocalizedText;
  landingPage: string;
  overview: LocalizedText;
  responsibilities: LocalizedText[];
  dailyChecklist: LocalizedText[];
  coreWorkflows: LocalizedText[];
  escalationPaths: LocalizedText[];
  faqs: Array<{ q: LocalizedText; a: LocalizedText }>;
  screenshotKeys: string[];
}

export interface PageGuide {
  routePattern: string;
  title: LocalizedText;
  module: string;
  roles: string[];
  summary: LocalizedText;
  purpose: LocalizedText;
  prerequisites: LocalizedText[];
  keyActions: LocalizedText[];
  fieldHelp: Array<{ field: LocalizedText; help: LocalizedText }>;
  decisionFlowId: string;
  commonErrors: Array<{ error: LocalizedText; reason: LocalizedText }>;
  recoverySteps: LocalizedText[];
  relatedRoutes: string[];
  screenshotKeys: string[];
  faqRefs?: string[];
}

/** One step of an end-to-end process chart (who does what, on which screen). */
export interface ProcessStep {
  title: LocalizedText;
  role: string;
  route?: string;
  detail: LocalizedText;
}

/** An end-to-end process drawn as a chart in the guide (order to dispatch, evening count …). */
export interface ProcessChart {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  modules?: string[];
  steps: ProcessStep[];
}

/** A module overview written for people and for the help bot (markdown, both languages). */
export interface ModuleDoc {
  module: string;
  slug: string;
  title: LocalizedText;
  en: string;
  hi: string;
}

/** Compact search / routing entry for one page guide (served as /help/data/index.json). */
export interface GuideIndexEntry {
  slug: string;
  route: string;
  module: string;
  roles: string[];
  title: LocalizedText;
  summary: LocalizedText;
}
