"use client";

import { ReportView } from "./report-view";

type ReportTabPageProps = {
  tab: string;
  title: string;
  description?: string;
  /** Kept for API compatibility; every report now shares one visual system. */
  accent?: string;
};

export function ReportTabPage({ tab, title, description }: ReportTabPageProps) {
  return <ReportView tab={tab} title={title} description={description} />;
}

export default ReportTabPage;
