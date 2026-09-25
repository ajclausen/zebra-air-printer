import { SectionHeader } from '../components/layout';
import { CertificatePanel } from '../settings/CertificatePanel';
import { ChangePasswordForm } from '../settings/ChangePasswordForm';
import { RebootPanel } from '../settings/RebootPanel';
import { StudioSettingsForm } from '../settings/StudioSettingsForm';

export function SettingsSection() {
  return (
    <>
      <SectionHeader title="Settings" description="Studio defaults, the admin password, the security certificate, and the Pi itself." />
      <div className="flex max-w-3xl flex-col gap-6">
        <StudioSettingsForm />
        <ChangePasswordForm />
        <CertificatePanel />
        <RebootPanel />
      </div>
    </>
  );
}
