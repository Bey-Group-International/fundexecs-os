import { ComponentGallery } from "@/components/design-system/ComponentGallery";

export const metadata = {
  title: "Design System — FundExecs OS",
};

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-surface-0 text-fg-primary">
      <div className="border-b border-line bg-surface-1/80 backdrop-blur-md">
        <div className="mx-auto max-w-[960px] px-8 py-6">
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">
            Design System
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Token reference and component variant gallery for FundExecs OS.
          </p>
        </div>
      </div>
      <ComponentGallery />
    </div>
  );
}
