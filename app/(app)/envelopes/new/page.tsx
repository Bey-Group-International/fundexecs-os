import type { Metadata } from "next";
import { EnvelopeWizard } from "./EnvelopeWizard";

export const metadata: Metadata = {
  title: "New Envelope — FundExecs OS",
  description: "Create and send a signature envelope to your recipients.",
};

export default function NewEnvelopePage() {
  return <EnvelopeWizard />;
}
