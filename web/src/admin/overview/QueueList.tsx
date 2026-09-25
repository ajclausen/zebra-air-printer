import type { QueueJob } from '@eco/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Spinner } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { useCancelJob } from '@/lib/api/queries';
import { formatRelativeTime, pluralize } from '@/lib/utils';
import { formatDateTime, jobStateMeta } from '../lib/format';

function sourceLabel(job: QueueJob): string {
  const source = job.source === 'studio' ? 'Label Studio' : 'AirPrint';
  return job.user && job.source === 'airprint' ? `${source}, ${job.user}` : source;
}

/** Jobs waiting at the printer, each with a Cancel action. */
export function QueueList({ jobs }: { jobs: QueueJob[] }) {
  const cancel = useCancelJob();

  function cancelJob(job: QueueJob) {
    cancel.mutate(job.id, {
      onSuccess: () => toast.success(`Canceled job ${job.id}`, { description: job.name }),
      onError: (error) => toast.error(`Could not cancel job ${job.id}`, { description: errorMessage(error) }),
    });
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-baseline justify-between px-5 pt-3.5 pb-2">
        <h3 id="queue-heading" className="text-sm font-semibold text-ink">
          Queue
        </h3>
        <span className="text-xs text-ink-3">{jobs.length === 0 ? 'Empty' : pluralize(jobs.length, 'job')}</span>
      </div>
      {jobs.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-ink-3">Nothing is waiting to print. Jobs show here until they finish.</p>
      ) : (
        <div className="pb-1.5">
          <table aria-labelledby="queue-heading" className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="hidden py-1.5 pr-3 pl-5 font-medium sm:table-cell">
                  Job
                </th>
                <th scope="col" className="w-full py-1.5 pr-3 pl-5 font-medium sm:pl-3">
                  Name
                </th>
                <th scope="col" className="hidden px-3 py-1.5 font-medium sm:table-cell">
                  From
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  State
                </th>
                <th scope="col" className="hidden px-3 py-1.5 font-medium md:table-cell">
                  Added
                </th>
                <th scope="col" className="py-1.5 pr-3 pl-1 sm:pr-5 sm:pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 border-t border-line/70">
              {jobs.map((job) => {
                const state = jobStateMeta[job.state];
                const pending = cancel.isPending && cancel.variables === job.id;
                return (
                  <tr key={job.id}>
                    <td className="tabular hidden py-2 pr-3 pl-5 text-ink-3 sm:table-cell">{job.id}</td>
                    <td className="max-w-0 py-2 pr-3 pl-5 sm:pl-3">
                      <p className="truncate text-ink" title={job.name}>
                        {job.name}
                      </p>
                      <p className="tabular truncate text-xs text-ink-3 sm:hidden">
                        Job {job.id} · {sourceLabel(job)}
                      </p>
                    </td>
                    <td className="hidden px-3 py-2 whitespace-nowrap text-ink-2 sm:table-cell">{sourceLabel(job)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </td>
                    <td className="hidden px-3 py-2 whitespace-nowrap text-ink-3 md:table-cell" title={job.createdAt ? formatDateTime(job.createdAt) : undefined}>
                      {job.createdAt ? formatRelativeTime(job.createdAt) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 pl-1 text-right sm:pr-5 sm:pl-3">
                      <Button size="sm" variant="ghost" onClick={() => cancelJob(job)} disabled={pending} aria-label={`Cancel job ${job.id}, ${job.name}`}>
                        {pending && <Spinner />}
                        Cancel
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
