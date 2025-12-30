import { useState, useEffect } from 'react';
import { getQueueService } from '../services/ServiceFactory';
import { QueueState } from '../services/QueueInterfaces';
import { QueueStatus } from '../components/QueueStatus';


// Global instance to prevent re-creation
const queueService = getQueueService();

const Queue = () => {
  const [queueState, setQueueState] = useState<QueueState>({
    currentServing: 0,
    lastUpdated: Date.now(),
    lastTicketIssued: 0,
    isAccepting: true,
    tickets: {}
  });

  // Persist ticket in localStorage
  const [myTicket, setMyTicket] = useState<number | null>(() => {
    const saved = localStorage.getItem('my_ticket');
    return saved ? parseInt(saved, 10) : null;
  });

  const [avgWait] = useState(5);

  useEffect(() => {
    // Subscribe to real-time updates
    const unsubscribe = queueService.subscribeToQueue((newState: QueueState) => {
      setQueueState(newState);

      // Check if our ticket still exists in the system (handle Reset Queue)
      setMyTicket((currentTicket) => {
        if (currentTicket && newState.tickets && !newState.tickets[currentTicket]) {
          // Ticket disappeared (Queue Reset or manual deletion)
          localStorage.removeItem('my_ticket');
          return null;
        }
        return currentTicket;
      });
    });
    return unsubscribe;
  }, []);

  const handleJoinQueue = async () => {
    try {
      const ticketNumber = await queueService.joinQueue();
      setMyTicket(ticketNumber);
      localStorage.setItem('my_ticket', ticketNumber.toString());
    } catch (error) {
      alert("Failed to join queue: " + error);
    }
  };

  const handleLeaveQueue = () => {
    if (confirm("Are you sure you want to leave the queue?")) {
      setMyTicket(null);
      localStorage.removeItem('my_ticket');
    }
  };

  // Derive status
  const tickets = queueState.tickets || {};
  const myTicketData = myTicket ? tickets[myTicket] : null;
  const myStatus = myTicketData?.status;

  // "Now Serving" typically means the person being actively served (Pending)
  const pendingTickets = Object.values(tickets).filter(t => t.status === 'pending');
  // Fallback: If no one is pending, maybe we show the last one called? Or 0?
  // For now, let's show the active pending one.
  const currentServingTicket = pendingTickets.length > 0 ? pendingTickets[0].id : 0;

  return (
    <div className="flex flex-col items-center justify-start px-4 py-8 pt-4 max-w-md mx-auto w-full space-y-8 animate-fade-in-down">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Artist Alley Queue</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">Real-time updates for your position</p>
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${queueState.isAccepting ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${queueState.isAccepting ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></span>
          {queueState.isAccepting ? "Queue Open" : "Queue Closed"}
        </div>
      </header>

      <QueueStatus
        currentPosition={currentServingTicket}
        myPosition={myTicket}
        myStatus={myStatus}
        averageWaitTimeMins={avgWait}
        onLeaveQueue={handleLeaveQueue}
      />

      {/* Action Button: Join */}
      {!myTicket && (
        <div className="w-full space-y-4">
          <button
            onClick={handleJoinQueue}
            disabled={!queueState.isAccepting}
            className={`w-full group relative flex items-center justify-center space-x-2 font-semibold py-4 px-6 rounded-xl shadow-lg transition-all transform active:scale-95 focus:outline-none focus:ring-4 ${queueState.isAccepting
                ? 'bg-primary hover:bg-primary-hover text-white shadow-primary/20 focus:ring-primary/30'
                : 'bg-slate-300 dark:bg-zinc-700 text-slate-500 cursor-not-allowed'
              }`}
          >
            <span className="material-icons-round text-xl">add_circle_outline</span>
            <span>{queueState.isAccepting ? "Get a Ticket" : "Queue Closed"}</span>
          </button>
          {!queueState.isAccepting && (
            <p className="text-center text-red-500 text-sm">The queue is currently not accepting new fans.</p>
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-auto pt-8 pb-4 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-200 rounded-lg text-xs font-medium border border-yellow-100 dark:border-yellow-900/30">
          <span className="material-icons-round text-sm">info</span>
          Please arrive 5 minutes before your turn.
        </div>
      </div>
    </div>
  );
};

export default Queue;
