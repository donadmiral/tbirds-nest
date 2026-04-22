import { networkService } from './networkService';

/**
 * Thin compatibility layer over networkService. Prefer importing
 * networkService directly in new code.
 */
export const connectionsService = {
  sendRequest: (requesterId: string, recipientId: string) =>
    networkService.sendConnectionRequest(requesterId, recipientId),

  getConnections: (userId: string) =>
    networkService.getConnections(userId),

  getPendingRequests: (userId: string) =>
    networkService.getPendingRequests(userId),

  getOutgoingRequests: (userId: string) =>
    networkService.getOutgoingRequests(userId),

  /**
   * When someone accepts a request, they are the recipient. The person
   * who originally sent the request is the requester.
   */
  acceptRequest: (requestId: string, requesterId: string, recipientId: string) =>
    networkService.acceptConnection(requestId, recipientId, requesterId),

  rejectRequest: (requestId: string) =>
    networkService.rejectConnection(requestId),

  removeConnection: (requestId: string) =>
    networkService.removeConnection(requestId),

  getCount: (userId: string) =>
    networkService.getConnectionCount(userId),
};