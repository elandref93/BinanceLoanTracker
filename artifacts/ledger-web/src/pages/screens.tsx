import { lazy } from "react";

export { AlertRuleEditorPage } from "@/pages/AlertRulesPage";
export { AccountDetailPage } from "./AccountDetailPage";
export { AccountsPage } from "./AccountsPage";
export { HomePage } from "@/home/HomePage";
export { OnboardingPage } from "./OnboardingPage";
export { PortfolioPage } from "@/portfolio/PortfolioPage";
export { HistoryPage } from "./HistoryPage";
export const StrategyPage = lazy(() => import("./StrategyPage").then((module) => ({ default: module.StrategyPage })));
export const SettingsPage = lazy(() => import("./SettingsPage").then((module) => ({ default: module.SettingsPage })));
export { DiagnosticsPage } from "./DiagnosticsPage";
export { SignInPage } from "./SignInPage";
export { LoansPage } from "@/loans/LoansPage";

export const InsightsPage = lazy(() => import("@/insights/InsightsPage").then((module) => ({ default: module.InsightsPage })));
