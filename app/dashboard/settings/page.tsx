import { PageHeader } from "@/components/DashboardUI";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Profile, defaults, and plan. Recordings and preferences stay in this browser; plan and billing are verified with your account."
      />
      <SettingsForm />
    </div>
  );
}
