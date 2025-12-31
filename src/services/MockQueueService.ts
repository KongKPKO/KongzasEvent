import { QueueService, QueueState } from './QueueInterfaces';

// In-memory mock state
let currentState: QueueState = {
  currentServing: 0,
  lastTicketIssued: 0,
  lastUpdated: Date.now(),
  isAccepting: true,
  tickets: {}
};

const listeners: Set<(state: QueueState) => void> = new Set();

const notify = () => {
  listeners.forEach(cb => cb({ ...currentState }));
};

const mockService = {
  subscribeToQueue: (callback: (state: QueueState) => void) => {
    listeners.add(callback);
    callback({ ...currentState }); // Initial value
    return () => listeners.delete(callback);
  },

  // Helper for E2E tests
  _forceExpire: (ticketId: number) => {
      if (currentState.tickets[ticketId]) {
          // Force status to expired directly to avoid timing issues in tests
          currentState.tickets[ticketId].status = 'expired';
          currentState.tickets[ticketId].calledAt = Date.now() - (31 * 60 * 1000); // Keep time logic just in case for display
          notify();
      }
  },

  updateServing: async (_number: number) => {
    console.warn("Deprecated updateServing called");
  },

  callNext: async () => {
    // Cleanup first
    mockService.cleanupExpired!();

    // 1. Complete Pending
    Object.values(currentState.tickets).forEach(t => {
      if (t.status === 'pending') {
        currentState.tickets[t.id].status = 'complete';
      }
    });

    // 2. Make next waiting Ready
    const waiting = Object.values(currentState.tickets)
      .filter(t => t.status === 'waiting')
      .sort((a, b) => a.id - b.id);

    if (waiting.length > 0) {
      const next = waiting[0];
      currentState.tickets[next.id] = { ...next, status: 'ready', calledAt: Date.now() };
    }
    notify();
  },

  cleanupExpired: async () => {
    const THIRTY_MINS = 30 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    Object.values(currentState.tickets).forEach(t => {
      if (t.status === 'ready' && t.calledAt && (now - t.calledAt > THIRTY_MINS)) {
        currentState.tickets[t.id].status = 'expired';
        changed = true;
      }
    });
    if (changed) notify();
  },

  confirmTicket: async (ticketId: number) => {
    const ticket = currentState.tickets[ticketId];
    if (ticket && (ticket.status === 'ready' || ticket.status === 'expired')) {
      currentState.tickets[ticketId].status = 'pending';
      notify();
    }
  },

  completeTicket: async (ticketId: number) => {
    const ticket = currentState.tickets[ticketId];
    if (ticket) {
      currentState.tickets[ticketId].status = 'complete';
      notify();
    }
  },

  joinQueue: async () => {
    const nextId = currentState.lastTicketIssued + 1;
    currentState.lastTicketIssued = nextId;
    currentState.tickets[nextId] = {
      id: nextId,
      status: 'waiting',
      timestamp: Date.now()
    };
    notify();
    return nextId;
  },

  resetQueue: async () => {
    currentState = {
      currentServing: 0,
      lastTicketIssued: 0,
      lastUpdated: Date.now(),
      isAccepting: true,
      tickets: {}
    };
    notify();
  },

  undoLastAction: async () => {
    console.log("Mock undo not implemented");
  }
};

export const MockQueueService = mockService as QueueService;
