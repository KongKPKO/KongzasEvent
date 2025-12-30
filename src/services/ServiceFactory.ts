import { MockQueueService } from './MockQueueService';
import { FirebaseQueueService } from './FirebaseQueueService';
import { QueueService } from './QueueInterfaces';

// Switch this to 'false' if you want to go back to local-only mode
const USE_FIREBASE = true;

let serviceInstance: QueueService | null = null;

export const getQueueService = (): QueueService => {
  if (!serviceInstance) {
    if (USE_FIREBASE) {
      serviceInstance = new FirebaseQueueService();
    } else {
      serviceInstance = MockQueueService;
    }
  }
  return serviceInstance;
};
