export type QueueCounts = {
  counts: Record<string, number | null>;
  alerts: number | null;
  unavailable: boolean;
};
