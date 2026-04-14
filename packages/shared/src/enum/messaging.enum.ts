// shared/enum/messaging.enum.ts

export enum SenderType {
  User = "user",
  Admin = "admin",
  System = "system",
  AiAgent = "ai_agent",
}

export enum ContentType {
  Text = "text",
  Html = "html",
  Structured = "structured",
}

export enum Channel {
  Inbox = "inbox",
  Email = "email",
  Sms = "sms",
  Push = "push",
}

export enum ConversationType {
  Direct = "direct",
  Broadcast = "broadcast",
  System = "system",
}
