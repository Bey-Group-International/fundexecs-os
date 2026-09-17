// Documents module: the firm's document repository (Library), the ways a new
// document is started (Create), and its contract paper (Agreements). Server
// component — every pane is rendered on the server and handed to the client tab
// shell as children.
import { DocumentsTabs } from "./DocumentsTabs";
import { DocumentsLibraryLive } from "./DocumentsLibraryLive";
import { CreateLive } from "./CreateLive";
import { DocumentsModuleLive } from "@/components/run/DocumentsModuleLive";
import { ContractReviewModule } from "@/components/run/ContractReviewModule";

export async function DocumentsHub() {
  return (
    <DocumentsTabs
      library={<DocumentsLibraryLive />}
      create={<CreateLive />}
      agreements={
        <>
          <DocumentsModuleLive />
          <ContractReviewModule />
        </>
      }
    />
  );
}
