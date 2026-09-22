// Tiny pub/sub correlating order command IDs with engine acks/rejects.

export type OrderAck = {
  command_id: string;
  status: "accepted" | "rejected";
  order_id?: string;
  action?: string;
  reason?: string;
};

type Listener = (ack: OrderAck) => void;

const listeners = new Set<Listener>();

export function emitOrderAck(ack: OrderAck): void {
  listeners.forEach((l) => {
    try {
      l(ack);
    } catch {
      /* listener errors must not break the stream */
    }
  });
}

export function onOrderAck(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
