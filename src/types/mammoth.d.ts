// mammoth ships no TypeScript types. This declares only the function the app uses.
declare module "mammoth" {
  interface Message {
    type: string;
    message: string;
  }
  interface RawTextResult {
    value: string;
    messages: Message[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;
  const mammoth: { extractRawText: typeof extractRawText };
  export default mammoth;
}
