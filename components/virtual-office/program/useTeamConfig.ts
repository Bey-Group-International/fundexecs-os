"use client";

// Subscribe a component to the Delegation Designer's applied team config. Reads
// localStorage on mount and re-reads whenever a design is applied (the
// TEAM_CONFIG_EVENT window event), so the roster and inspector reflect the
// operator's team design live.
import { useEffect, useState } from "react";
import { loadTeamConfig, TEAM_CONFIG_EVENT, type TeamConfig } from "@/lib/office/teamConfig";

export function useTeamConfig(): TeamConfig {
  const [cfg, setCfg] = useState<TeamConfig>({});
  useEffect(() => {
    setCfg(loadTeamConfig());
    const onChange = () => setCfg(loadTeamConfig());
    window.addEventListener(TEAM_CONFIG_EVENT, onChange);
    return () => window.removeEventListener(TEAM_CONFIG_EVENT, onChange);
  }, []);
  return cfg;
}
