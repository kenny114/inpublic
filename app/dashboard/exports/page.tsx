import { NotReadyNote, PageHeader } from "@/components/DashboardUI";
import { ExportsList } from "@/components/ExportsList";

export default function ExportsPage() {
  return (
    <div>
      <PageHeader
        title="Exports"
        description="Download what this browser has stored: session state as JSON, and recordings as WebM with their transcript."
      />
      <ExportsList />
      <NotReadyNote>
        PNG, SVG, and Excalidraw exports are produced on the canvas itself and are not kept here — use the export controls in the canvas toolbar for those.
      </NotReadyNote>
    </div>
  );
}
