import React from 'react';
import { Card, Button } from './ui';
import { SkipForward, RotateCcw, Users } from 'lucide-react';

interface AdminQueueControlsProps {
  nextTicketId: number | null;
  pendingCount: number;
  readyCount: number;
  waitingCount: number;
  onCallNext: () => void;
  onUndo: () => void;
  onReset: () => void;
}

export const AdminQueueControls: React.FC<AdminQueueControlsProps> = ({
  nextTicketId,
  pendingCount,
  readyCount,
  waitingCount,
  onCallNext,
  onUndo,
  onReset
}) => {
  const handleCallNext = () => {
    onCallNext();
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-2xl font-bold">Queue Control</h2>
          <p className="text-gray-500 text-sm">Manage the flow of the event</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-sm font-medium text-gray-600">
          <Users size={16} />
          <span>Total: {pendingCount + readyCount + waitingCount}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-center">
        {/* Next to Serve Display */}
        <div className="text-center p-6 bg-slate-50 rounded-2xl border border-slate-200 relative overflow-hidden">
          <div className="text-sm font-bold uppercase text-slate-600 tracking-wider mb-2">
            Next Ticket
          </div>
          <div className="text-8xl font-black text-slate-950 leading-tight">
            {nextTicketId ? `#${nextTicketId}` : '-'}
          </div>
          <div className="mt-2 text-slate-700 font-medium text-sm">
            {waitingCount} waiting
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <Button 
             size="lg" 
             onClick={handleCallNext}
             disabled={waitingCount === 0}
             className="w-full shadow-lg shadow-pink-100 disabled:opacity-50 disabled:cursor-not-allowed bg-pink-600 hover:bg-pink-700 text-white"
          >
            <SkipForward className="mr-2" size={20} />
            Call Next
          </Button>

          <Button 
            variant="outline"
            onClick={onUndo}
            className="w-full text-gray-600 border-gray-200 hover:bg-gray-50"
          >
            Undo Last
          </Button>

          <div className="pt-4 border-t border-gray-100 mt-2">
            <Button 
              variant="ghost" 
              className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => {
                if(confirm("Are you sure you want to reset the queue? This cannot be undone.")) {
                  onReset();
                  localStorage.removeItem('queue_timer_end');
                }
              }}
            >
              <RotateCcw size={16} className="mr-2" />
              Reset Queue
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};
