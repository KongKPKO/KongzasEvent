import { db } from '../firebase';
import { doc, onSnapshot, runTransaction, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { QueueService, QueueState, TicketData } from './QueueInterfaces';

const QUEUE_DOC_ID = 'default';
const QUEUE_COLLECTION = 'queues';

export class FirebaseQueueService implements QueueService {
  private docRef = doc(db, QUEUE_COLLECTION, QUEUE_DOC_ID);

  constructor() {
    this.ensureDocumentExists();
  }

  // Helper to make sure the database entry exists on first run
  private async ensureDocumentExists() {
    const snap = await getDoc(this.docRef);
    if (!snap.exists()) {
      await setDoc(this.docRef, {
        lastTicketIssued: 0,
        isAccepting: true,
        lastUpdated: Date.now(),
        tickets: {}
      });
    }
  }

  subscribeToQueue(callback: (state: QueueState) => void) {
    // Real-time listener
    const unsubscribe = onSnapshot(this.docRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        callback({
          currentServing: 0, // Deprecated, but satisfying interface
          lastTicketIssued: data.lastTicketIssued || 0,
          lastUpdated: data.lastUpdated,
          isAccepting: data.isAccepting,
          tickets: data.tickets || {}
        });
      }
    });
    return unsubscribe;
  }

  // DEPRECATED: Legacy direct update, handled via callNext now
  async updateServing(_number: number): Promise<void> {
    console.warn("updateServing is deprecated, use callNext instead.");
  }

  async callNext(): Promise<void> {
    await this.cleanupExpired(); // Run cleanup before calling next

    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};

      // SAVE SNAPSHOT FOR UNDO
      const previousTickets = JSON.parse(JSON.stringify(tickets));

      // 1. Complete any "Pending" tickets
      Object.values(tickets).forEach(t => {
        if (t.status === 'pending') {
          tickets[t.id] = { ...t, status: 'complete' };
        }
      });

      // 2. Find next "Waiting" ticket to make "Ready"
      const waitingTickets = Object.values(tickets)
        .filter(t => t.status === 'waiting')
        .sort((a, b) => a.id - b.id);

      if (waitingTickets.length > 0) {
        const nextTicket = waitingTickets[0];
        tickets[nextTicket.id] = {
          ...nextTicket,
          status: 'ready',
          calledAt: Date.now()
        };
      }

      txn.update(this.docRef, {
        tickets: tickets,
        previousTickets: previousTickets, // Save state
        lastUpdated: Date.now()
      });
    });
  }

  async undoLastAction(): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      if (data.previousTickets) {
        txn.update(this.docRef, {
          tickets: data.previousTickets,
          previousTickets: null, // Consume the undo (optional, keeps it one-step undo)
          lastUpdated: Date.now()
        });
      }
    });
  }

  async cleanupExpired(): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      let changed = false;

      const THIRTY_MINS = 30 * 60 * 1000;
      const now = Date.now();

      Object.values(tickets).forEach(t => {
        if (t.status === 'ready' && t.calledAt && (now - t.calledAt > THIRTY_MINS)) {
          tickets[t.id] = { ...t, status: 'expired' };
          changed = true;
        }
      });

      if (changed) {
        txn.update(this.docRef, {
          tickets: tickets,
          lastUpdated: now
        });
      }
    });
  }

  async confirmTicket(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      const ticket = tickets[ticketId];

      if (ticket && (ticket.status === 'ready' || ticket.status === 'expired')) {
        // SAVE SNAPSHOT FOR UNDO
        const previousTickets = JSON.parse(JSON.stringify(tickets));

        tickets[ticketId] = { ...ticket, status: 'pending' };
        txn.update(this.docRef, {
          tickets: tickets,
          previousTickets: previousTickets, // Save state
          lastUpdated: Date.now()
        });
      }
    });
  }

  async completeTicket(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      const ticket = tickets[ticketId];

      if (ticket) {
        // SAVE SNAPSHOT FOR UNDO
        const previousTickets = JSON.parse(JSON.stringify(tickets));

        tickets[ticketId] = { ...ticket, status: 'complete' };
        txn.update(this.docRef, {
          tickets: tickets,
          previousTickets: previousTickets, // Save state
          lastUpdated: Date.now()
        });
      }
    });
  }

  async joinQueue(): Promise<number> {
    let myTicket = 0;

    // Transaction ensures no two people get the same number
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(this.docRef);
      if (!docSnap.exists()) {
        throw "Queue does not exist!";
      }

      const data = docSnap.data();
      if (!data.isAccepting) {
        throw new Error("Queue is closed");
      }

      const nextTicket = (data.lastTicketIssued || 0) + 1;
      myTicket = nextTicket;

      const tickets = data.tickets || {};
      const newTicket: TicketData = {
        id: nextTicket,
        status: 'waiting',
        timestamp: Date.now()
      };

      tickets[nextTicket] = newTicket;

      transaction.update(this.docRef, {
        lastTicketIssued: nextTicket,
        lastUpdated: Date.now(),
        tickets: tickets
      });
    });

    return myTicket;
  }

  async resetQueue(): Promise<void> {
    await updateDoc(this.docRef, {
      currentServing: 0,
      lastTicketIssued: 0,
      isAccepting: true,
      lastUpdated: Date.now(),
      tickets: {}
    });
  }

  // Helper for E2E tests
  async _forceExpire(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      
      if (tickets[ticketId]) {
         tickets[ticketId].status = 'expired';
         tickets[ticketId].calledAt = Date.now() - (35 * 60 * 1000); // > 30 mins
         
         txn.update(this.docRef, {
            tickets: tickets,
            lastUpdated: Date.now()
         });
      }
    });
  }
}
