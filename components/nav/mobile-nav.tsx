"use client";

import { createContext, useContext, useState } from "react";

// Below the `md` breakpoint the primary sidebar (hubs, sessions, account menu)
// is `hidden` with no alternative — there was no way to navigate between hubs
// on a phone at all. This context lets the header (rendered as a sibling of
// the sidebar in the app shell) toggle a slide-over copy of the same nav.
interface MobileNavValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const MobileNavContext = createContext<MobileNavValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
