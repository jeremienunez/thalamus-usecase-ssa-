// STUBBED FOR INTERVIEW EXTRACTION — no-op messaging.
import { createLogger } from "@interview/shared";
import type { SenderType, ContentType, Channel, ConversationType } from "@interview/shared/enum/messaging.enum";

const logger = createLogger("messaging-stub");

export interface SendMessageInput {
  senderId: string | number;
  senderType: SenderType;
  senderName?: string;
  content: string;
  contentType: ContentType;
  channels: Channel[];
  recipientIds?: Array<string | number>;
  conversationType?: ConversationType;
  subject?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  senderId: string | number;
  content: string;
  createdAt: string;
}

export class MessagingService {
  async send(input: SendMessageInput): Promise<Message> {
    logger.info("MessagingService.send (stub)", { sender: input.senderId, recipients: input.recipientIds });
    return {
      id: `msg-stub-${Date.now()}`,
      senderId: input.senderId,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
  }
}
