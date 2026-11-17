/** Sends a message to the IDE. The bridge is absent until the host injects it, and in a plain browser. */
export function sendToHost(message) {
  if (window.bpmnCompareHost) {
    window.bpmnCompareHost(message);
  }
}
