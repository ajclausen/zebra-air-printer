import { CopyIcon, DownloadIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { cn } from '@/lib/utils';
import { DefinitionList, DefinitionRow, Panel, PanelHeader } from '../components/layout';
import { Skeleton } from '../components/states';
import { formatDate, formatRelative } from '../lib/format';
import { useSystemInfo } from '../queries';

type Platform = 'macos' | 'ios' | 'windows';

const CA_NAME = 'ECO Label Studio Local CA';

const INSTRUCTIONS: Record<Platform, { label: string; steps: string[] }> = {
  macos: {
    label: 'macOS',
    steps: [
      'Download the certificate and double-click it. Keychain Access opens and adds it to your login keychain.',
      `In Keychain Access, find “${CA_NAME}” and double-click it.`,
      'Open the Trust section and set “When using this certificate” to Always Trust.',
      'Close the window and enter your Mac password to confirm.',
    ],
  },
  ios: {
    label: 'iPhone and iPad',
    steps: [
      'Open this page in Safari, tap Download certificate, then tap Allow.',
      'Open Settings, tap Profile Downloaded near the top, then tap Install.',
      'Go to Settings › General › About › Certificate Trust Settings.',
      `Turn on full trust for “${CA_NAME}”.`,
    ],
  },
  windows: {
    label: 'Windows',
    steps: [
      'Download the certificate and open it, then click Install Certificate.',
      'Choose Current User and click Next.',
      'Choose “Place all certificates in the following store”, click Browse, and pick Trusted Root Certification Authorities.',
      'Click Next, then Finish, then Yes on the security warning. Restart your browser.',
    ],
  },
};

function defaultPlatform(): Platform {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/.test(agent)) return 'windows';
  return 'macos';
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied the fingerprint');
  } catch {
    toast.error('Could not copy the fingerprint', { description: 'Select it and copy it by hand.' });
  }
}

function CertificateFacts() {
  const system = useSystemInfo({ poll: false });
  if (system.isPending) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3" role="status" aria-label="Loading certificate details">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }
  if (system.isError) return <p className="px-4 py-3 text-sm text-ink-3">Certificate details are not available right now.</p>;

  const { fingerprintSha256, notAfter } = system.data.certificate;
  return (
    <DefinitionList>
      <DefinitionRow label="Fingerprint">
        {fingerprintSha256 ? (
          <span className="flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs leading-[18px] text-ink-2" title="SHA-256 fingerprint">
              {fingerprintSha256.split(':').map((byte, index) => (
                <Fragment key={index}>
                  {index > 0 && ':'}
                  <wbr />
                  {byte}
                </Fragment>
              ))}
            </code>
            <Button variant="ghost" size="icon-xs" onClick={() => void copyToClipboard(fingerprintSha256)} aria-label="Copy SHA-256 fingerprint">
              <CopyIcon />
            </Button>
          </span>
        ) : (
          <span className="text-ink-3">Unknown</span>
        )}
      </DefinitionRow>
      <DefinitionRow label="Expires">{notAfter ? `${formatDate(notAfter)} (${formatRelative(notAfter)})` : <span className="text-ink-3">Unknown</span>}</DefinitionRow>
    </DefinitionList>
  );
}

export function CertificatePanel() {
  const [platform, setPlatform] = useState<Platform>(defaultPlatform);
  return (
    <Panel aria-labelledby="certificate-heading">
      <PanelHeader
        id="certificate-heading"
        title="Security certificate"
        description="Trust it once on each device and the browser stops warning that this site is not secure."
        actions={
          <a href="/ca.crt" download="eco-label-studio-ca.crt" className={cn(buttonVariants({ variant: 'secondary' }))}>
            <DownloadIcon />
            Download certificate
          </a>
        }
      />
      <CertificateFacts />
      <Tabs value={platform} onValueChange={(value) => setPlatform(value as Platform)} className="border-t border-line/70 px-4 pt-4 pb-5">
        <TabsList aria-label="Device" className="max-w-full overflow-x-auto">
          {(Object.keys(INSTRUCTIONS) as Platform[]).map((key) => (
            <TabsTrigger key={key} value={key} className="whitespace-nowrap">
              {INSTRUCTIONS[key].label}
            </TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(INSTRUCTIONS) as Platform[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-4 outline-none">
            <ol className="flex flex-col gap-2.5">
              {INSTRUCTIONS[key].steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm text-ink-2">
                  <span aria-hidden className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-2xs font-semibold text-ink-2">
                    {index + 1}
                  </span>
                  <span className="pt-px">{step}</span>
                </li>
              ))}
            </ol>
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}
