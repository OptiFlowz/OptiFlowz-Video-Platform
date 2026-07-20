import PlatformSettingsHeader from "./platformSettingsHeader";

export default function AdvancedSettings() {
  return (
    <>
      <PlatformSettingsHeader activePage="advanced" />
      <section className="platformSettingsCard platformSettingsPlaceholder">
        <h2>Advanced Settings</h2>
        <p>This settings page is ready for its configuration controls.</p>
      </section>
    </>
  );
}
