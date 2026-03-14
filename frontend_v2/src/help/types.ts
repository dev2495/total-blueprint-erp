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
