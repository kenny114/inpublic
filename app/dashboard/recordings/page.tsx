import { PageHeader } from "@/components/DashboardUI";
import { SessionsList } from "@/components/SessionsList";

export default function RecordingsPage() {
  return (
    <div>
      <PageHeader
        title="Recordings"
        description="Saved in this browser. Download a recording with its transcript and session state."
      />
      <SessionsList />
    </div>
  );
}
