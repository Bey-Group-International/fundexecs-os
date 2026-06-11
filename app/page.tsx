/**
 * Home — placeholder for the new frontend.
 *
 * The previous landing/visual workflow was archived to the
 * `archive/frontend-2026-06-11` branch. The new visual workflow is built fresh
 * on top of the preserved backend (lib/, app/api, supabase). Replace this page
 * as the new surfaces come online.
 */
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center'
      }}
    >
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>FundExecs OS</h1>
        <p style={{ marginTop: '0.5rem', opacity: 0.7 }}>New frontend — coming together.</p>
      </div>
    </main>
  );
}
