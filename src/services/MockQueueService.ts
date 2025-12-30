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

export const MockQueueService: QueueService = {
  subscribeToQueue: (callback) => {
    listeners.add(callback);
    callback({ ...currentState }); // Initial value
    return () => listeners.delete(callback);
  },

  updateServing: async (_number) => {
    console.warn("Deprecated updateServing called");
  },

  callNext: async () => {
    // Cleanup first
    MockQueueService.cleanupExpired!();

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

  confirmTicket: async (ticketId) => {
    const ticket = currentState.tickets[ticketId];
    if (ticket && ticket.status === 'ready') {
      currentState.tickets[ticketId].status = 'pending';
      notify();
    }
  },

  completeTicket: async (ticketId) => {
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
