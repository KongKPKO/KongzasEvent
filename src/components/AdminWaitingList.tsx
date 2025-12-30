import React from 'react';
import { Card } from './ui';
import { TicketData } from '../services/QueueInterfaces';

interface AdminWaitingListProps {
  tickets: TicketData[];
}

export const AdminWaitingList: React.FC<AdminWaitingListProps> = ({
  tickets
}) => {
  if (tickets.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-700">Waiting Customers ({tickets.length})</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tickets.map((ticket) => (
          <Card key={ticket.id} className="flex justify-between items-center p-4 hover:shadow-md transition-shadow cursor-default border-l-4 border-l-gray-300 bg-white">
            <div>
              <span className="text-xs text-gray-400 uppercase font-bold">Ticket</span>
              <div className="text-2xl font-bold text-gray-600">#{ticket.id}</div>
              <div className="text-xs text-gray-400 mt-1">
                 Waited {Math.floor((Date.now() - ticket.timestamp)/60000)}m
              </div>
            </div>
            {/* Note: interactive "Admit" removed to enforce strict Queue Order via "Call Next" button in controls. 
                Can add "Jump Queue" feature later if needed. */}
          </Card>
        ))}
      </div>
    </div>
  );
};
