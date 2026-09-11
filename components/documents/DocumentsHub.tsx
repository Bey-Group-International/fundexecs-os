// Documents module: the firm's document repository (Library) plus its contract
// paper (Agreements). Server component — both panes are rendered on the server
// and handed to the client tab shell as children.
import { DocumentsTabs } from "./DocumentsTabs";
import { DocumentsLibraryLive } from "./DocumentsLibraryLive";
import { DocumentsModuleLive } from "@/components/run/DocumentsModuleLive";
import { ContractReviewModule } from "@/components/run/ContractReviewModule";

export async function DocumentsHub() {
  return (
    <DocumentsTabs
      library={<DocumentsLibraryLive />}
      agreements={
        <>
          <DocumentsModuleLive />
          <ContractReviewModule />
        </>
      }
    />
  );
}
