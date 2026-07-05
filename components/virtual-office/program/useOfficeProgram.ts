"use client";

import { useSyncExternalStore } from "react";
import {
  getOfficeProgramState,
  subscribeOfficeProgram,
  type OfficeProgramState,
} from "./officeProgramStore";

/** Subscribe a React component to the office program store. */
export function useOfficeProgram(): OfficeProgramState {
  return useSyncExternalStore(
    subscribeOfficeProgram,
    getOfficeProgramState,
    getOfficeProgramState
  );
}
