import { ArrowRight, Check, Circle, LockKeyhole } from 'lucide-react';
import type { SetupReadiness, SetupStepId } from '../../lib/setupReadiness';

interface GuidedSetupPanelProps {
  readiness: SetupReadiness;
  eventId: string;
  compact?: boolean;
  onEditEvent: () => void;
  onNavigate: (path: string) => void;
}

const destinationFor = (step: SetupStepId, eventId: string) => {
  if (step === 'profile' || step === 'publish') return '/manage-events?focus=publish';
  if (step === 'catalog') return `/manage-events/${eventId}/catalog`;
  if (step === 'payment') return `/manage-events/${eventId}/preorder`;
  return null;
};

export default function GuidedSetupPanel({ readiness, eventId, compact = false, onEditEvent, onNavigate }: GuidedSetupPanelProps) {
  const next = readiness.nextStep;
  const openStep = (stepId: SetupStepId) => {
    if (stepId === 'event') {
      onEditEvent();
      return;
    }
    const destination = destinationFor(stepId, eventId);
    if (destination) onNavigate(destination);
  };

  return (
    <section className={`mb-5 overflow-hidden rounded-2xl border shadow-sm ${compact ? 'border-gray-200 bg-white' : 'border-pink-200 bg-[#fffafc]'}`} aria-label="Guided booth setup">
      <div className="border-b border-pink-100 px-4 py-4 sm:px-5">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-pink-700">{compact ? 'Setup health' : 'First-run guide'}</p>
        <h2 className="mt-1 text-xl font-black text-gray-950">{readiness.complete ? 'Booth setup is ready' : 'One clear step at a time'}</h2>
        <p className="mt-1 text-sm font-semibold text-gray-600">Completion is calculated from your real booth and event data—there is no separate wizard state to maintain.</p>
      </div>

      <ol className={`grid gap-px bg-gray-100 ${compact ? 'md:grid-cols-5' : 'md:grid-cols-5'}`}>
        {readiness.steps.map((step, index) => (
          <li key={step.id} className="bg-white p-4">
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${step.complete ? 'bg-emerald-100 text-emerald-700' : step.required ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                {step.complete ? <Check size={15} aria-hidden="true" /> : step.required ? <Circle size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}
              </span>
              <span className="text-xs font-black text-gray-400">{index + 1}/5</span>
            </div>
            <h3 className="mt-3 text-sm font-black text-gray-900">{step.title}</h3>
            <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">{step.detail}</p>
          </li>
        ))}
      </ol>

      {!compact && next && (
        <div className="flex flex-col gap-3 border-t border-pink-100 bg-pink-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-pink-700">Next action</p>
            <p className="mt-1 text-sm font-bold text-gray-800">{next.title}: {next.detail}</p>
          </div>
          <button type="button" onClick={() => openStep(next.id)} className="workspace-action inline-flex items-center justify-center gap-2 bg-pink-700 px-4 text-sm font-black text-white hover:bg-pink-800">
            Continue setup <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
