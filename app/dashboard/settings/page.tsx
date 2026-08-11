import { PageHeader } from "@/components/DashboardUI";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />
      <SettingsForm />
    </div>
  );
}
