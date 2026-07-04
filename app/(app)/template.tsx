export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="motion-safe:animate-fade-up">{children}</div>;
}
