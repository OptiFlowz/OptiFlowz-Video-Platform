export {};

declare global {
  interface Window {
    optiflowzSendMessage?: (message: string) => void;
  }
}