import { NotReadyNote, PageHeader } from "@/components/DashboardUI";
import { ExportsList } from "@/components/ExportsList";

export default function ExportsPage() {
  return (
    <div>
      <PageHeader
        title="Exports"
        description="Everything this browser has stored, ready to download."
      />
      <ExportsList />
      <NotReadyNote>
        PNG, SVG, and Excalidraw exports are produced on the canvas itself and are not kept here — use the export controls in the canvas toolbar for those.
      </NotReadyNote>
    </div>
  );
}
