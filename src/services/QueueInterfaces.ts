export type TicketStatus = 'waiting' | 'ready' | 'pending' | 'complete' | 'expired';

export interface TicketData {
  id: number;
  status: TicketStatus;
  timestamp: number; // Joined at
  calledAt?: number; // When status became 'ready'
}

export interface QueueState {
  currentServing: number; // DEPRECATED: Use tickets instead, but kept for compat if needed temporarily
  lastTicketIssued: number;
  lastUpdated: number;
  isAccepting: boolean;
  tickets: Record<number, TicketData>; // Map of ticket ID to data
}

export interface QueueService {
  subscribeToQueue: (callback: (state: QueueState) => void) => () => void;
  // Admin Actions
  callNext: () => Promise<void>; 
  confirmTicket: (ticketId: number) => Promise<void>;
  cleanupExpired: () => Promise<void>;
  updateServing: (number: number) => Promise<void>; // Legacy direct update, might remove or keep as fallback
  joinQueue: () => Promise<number>;
  resetQueue: () => Promise<void>;
  completeTicket: (ticketId: number) => Promise<void>;
  undoLastAction: () => Promise<void>;
}
