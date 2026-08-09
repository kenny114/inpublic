import { PageHeader } from "@/components/DashboardUI";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Profile, defaults, and plan. Everything here is stored in this browser until accounts and billing are connected."
      />
      <SettingsForm />
    </div>
  );
}
