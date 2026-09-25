import { PrinterIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { useTestPrint } from '../queries';

/** Sends the server-generated test label. Shared by the overview and printer settings. */
export function TestPrintButton({ variant = 'secondary', className }: { variant?: ButtonProps['variant']; className?: string }) {
  const testPrint = useTestPrint();
  return (
    <Button
      variant={variant}
      className={className}
      disabled={testPrint.isPending}
      onClick={() =>
        testPrint.mutate(undefined, {
          onSuccess: (result) =>
            toast.success('Sent a test label to the printer', {
              description: result.jobIds.length > 0 ? `Job ${result.jobIds.join(', ')}` : undefined,
            }),
          onError: (error) => toast.error('Could not print a test label', { description: errorMessage(error) }),
        })
      }
    >
      {testPrint.isPending ? <Spinner /> : <PrinterIcon />}
      Print test label
    </Button>
  );
}
