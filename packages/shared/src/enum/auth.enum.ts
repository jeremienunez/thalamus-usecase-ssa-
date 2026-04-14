/**
 * Auth & Subscription enums
 * Shared between frontend and backend
 */

export enum VerificationCodeType {
  Registration = "registration",
  Login = "login",
  PasswordReset = "password_reset",
}

export enum SubscriptionTier {
  Free = "free",
  Enthusiast = "enthusiast",
  Investment = "investment",
  Franchise = "franchise",
}

export enum SubscriptionStatus {
  Active = "active",
  Trialing = "trialing",
  PastDue = "past_due",
  Canceled = "canceled",
}

export enum UserRole {
  User = "user",
  Admin = "admin",
  Seo = "seo",
}
