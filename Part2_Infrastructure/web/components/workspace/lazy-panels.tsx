"use client";

/**
 * The ten panel components, wrapped once.
 *
 * Two wrappers, both of which have to happen exactly once for the whole desk,
 * which is why they sit beside the panels rather than inside them.
 */

import { memo } from "react";

import dynamic from "next/dynamic";

import PortfolioWorkspace from "@/components/PortfolioWorkspace";
import RiskWorkspace from "@/components/RiskWorkspace";
import WorkspaceOverview from "@/components/WorkspaceOverview";

/**
 * The console workspaces load as their own chunks: they are the heaviest
 * subtrees here and none is needed for first paint, so the initial bundle stops
 * carrying them. `useConsolePrefetch` warms the chunks before the first click,
 * and the loading box holds a panel-sized rectangle so the one cold visit
 * cannot shift the layout.
 */
const PanelLoading = () => (
  <div className="skeleton" style={{ height: 480 }} aria-busy="true" aria-label="Loading workspace" />
);
const DataConsole = dynamic(() => import("@/components/DataConsole"), { loading: PanelLoading });
const ReliabilityConsole = dynamic(() => import("@/components/ReliabilityConsole"), { loading: PanelLoading });
const DeveloperConsole = dynamic(() => import("@/components/DeveloperConsole"), { loading: PanelLoading });
const MarketsConsole = dynamic(() => import("@/components/MarketsConsole"), { loading: PanelLoading });
const CoherenceConsole = dynamic(() => import("@/components/CoherenceConsole"), { loading: PanelLoading });

/**
 * Memoised once, at module level. The seven persistent tabs stay mounted behind
 * `hidden`, so every page-level state change would otherwise re-render all of
 * them; with memo (and the stable hook returns backing their props) a hidden
 * tab re-renders only when the data it actually shows changed.
 */
export const OverviewTab = memo(WorkspaceOverview);
export const PortfolioTab = memo(PortfolioWorkspace);
export const RiskTab = memo(RiskWorkspace);
export const DataTab = memo(DataConsole);
export const ReliabilityTab = memo(ReliabilityConsole);
export const DeveloperTab = memo(DeveloperConsole);
export const MarketsTab = memo(MarketsConsole);
export const CoherenceTab = memo(CoherenceConsole);
