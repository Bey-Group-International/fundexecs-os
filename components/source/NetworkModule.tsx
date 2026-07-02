"use client";

import { useState } from "react";
import { NetworkSearch } from "./NetworkSearch";
import { LinkedInImportModal } from "./LinkedInImportModal";
import { WarmIntroPanel } from "./WarmIntroPanel";
import { SyndicateCircle } from "./SyndicateCircle";
import type { NetworkSearchResult } from "@/lib/network-search";

type Tab = "search" | "import" | "circles";

interface Circle {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  senderName: string;
  senderTitle?: string | null;
  initialContacts?: number;
  circles?: Circle[];
}

export function NetworkModule({ senderName, senderTitle, initialContacts = 0, circles = [] }: Props) {
  const [tab, setTab] = useState<Tab>("search");
  const [showImport, setShowImport] = useState(false);
  const [contactCount, setContactCount] = useState(initialContacts);
  const [selectedContact, setSelectedContact] = useState<NetworkSearchResult | null>(null);
  const [circleList, setCircleList] = useState<Circle[]>(circles);
  const [importSuccess, setImportSuccess] = useState<number | null>(null);

  async function handleCreateCircle(name: string, description: string) {
    const res = await fetch("/api/network/circles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      const circle = await res.json();
      setCircleList((prev) => [circle, ...prev]);
    }
  }

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: "search",
      label: "Search Network",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      key: "import",
      label: "Import",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-8-4-4m0 0L8 8m4-4v12" />
        </svg>
      ),
    },
    {
      key: "circles",
      label: "Circles",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Stats strip */}
      <div className="flex items-center gap-6 rounded-xl border border-line bg-surface px-5 py-3">
        <div>
          <p className="text-2xl font-semibold text-fg">{contactCount.toLocaleString()}</p>
          <p className="text-xs text-fg-muted">Contacts</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className="text-2xl font-semibold text-fg">{circleList.length}</p>
          <p className="text-xs text-fg-muted">Circles</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div className="flex-1" />
        {contactCount === 0 && (
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            Import LinkedIn network →
          </button>
        )}
      </div>

      {/* Import success banner */}
      {importSuccess !== null && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400 flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Successfully imported {importSuccess.toLocaleString()} contacts. Relationship scores will update shortly.
          <button onClick={() => setImportSuccess(null)} className="ml-auto text-emerald-400/60 hover:text-emerald-400">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-accent text-fg font-medium"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="ml-auto pb-1">
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg hover:border-fg-muted/40 transition-colors flex items-center gap-1.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" />
            </svg>
            Import CSV
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div>
        {tab === "search" && (
          <NetworkSearch
            onSelectContact={(contact) => setSelectedContact(contact)}
          />
        )}

        {tab === "import" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-line bg-surface p-6 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0A66C2]/10">
                  <svg className="h-6 w-6 text-[#0A66C2]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-fg">LinkedIn Connections</p>
                  <p className="text-sm text-fg-muted">Import your full LinkedIn network in one click</p>
                </div>
              </div>
              <button
                onClick={() => setShowImport(true)}
                className="rounded-lg bg-[#0A66C2] py-2.5 text-sm font-medium text-white hover:bg-[#0A66C2]/90 transition-colors"
              >
                Upload LinkedIn CSV Export
              </button>
              <p className="text-xs text-fg-muted">
                We never access your LinkedIn account. Export is done directly from LinkedIn → Settings → Data Privacy → Get a copy of your data.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-surface p-6 flex flex-col gap-3 opacity-60">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fg-muted/10">
                  <svg className="h-5 w-5 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-fg text-sm">Google Contacts</p>
                  <p className="text-xs text-fg-muted">Coming soon</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "circles" && (
          <SyndicateCircle circles={circleList} onCreateCircle={handleCreateCircle} />
        )}
      </div>

      {/* Modals */}
      {showImport && (
        <LinkedInImportModal
          onClose={() => setShowImport(false)}
          onImported={(count) => {
            setContactCount((prev) => prev + count);
            setImportSuccess(count);
            setShowImport(false);
          }}
        />
      )}

      {selectedContact && (
        <WarmIntroPanel
          contact={selectedContact}
          senderName={senderName}
          senderTitle={senderTitle}
          onClose={() => setSelectedContact(null)}
        />
      )}
    </div>
  );
}
