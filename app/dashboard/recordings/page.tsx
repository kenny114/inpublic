import { PageHeader } from "@/components/DashboardUI";
import { SessionsList } from "@/components/SessionsList";

export default function RecordingsPage() {
  return (
    <div>
      <PageHeader
        title="Recordings"
        description="Canvas, microphone, and optional camera captured together. Recordings are stored in this browser and can be downloaded as WebM with their transcript and session state."
      />
      <SessionsList />
    </div>
  );
}
